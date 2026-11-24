export type SorobanSubmissionErrorCode =
	| 'RPC_ERROR'
	| 'TRANSACTION_FAILED'
	| 'NOT_CONFIRMED'
	| 'TRY_AGAIN_LATER'

type SorobanSendStatus = 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR'
type SorobanAcceptedSendStatus = 'PENDING' | 'DUPLICATE' | 'ERROR'
type SorobanSuccessfulTransaction = { status: 'SUCCESS' }
type SorobanGetTransactionResponse =
	| SorobanSuccessfulTransaction
	| { status: 'FAILED' }
	| { status: 'NOT_FOUND' }

interface SorobanSendResponse {
	status: SorobanSendStatus
	hash: string
	errorResult?: unknown
	errorResultXdr?: string
}

export interface SorobanTxServer<
	TTransaction = unknown,
	TGetTransactionResponse extends SorobanGetTransactionResponse = SorobanGetTransactionResponse,
> {
	sendTransaction(transaction: TTransaction): Promise<SorobanSendResponse>
	getTransaction(hash: string): Promise<TGetTransactionResponse>
}

export interface SubmitSorobanTxOptions {
	pollAttempts?: number
	pollIntervalMs?: number
	retryAttempts?: number
	retryBackoffMs?: number
	sleep?: (milliseconds: number) => Promise<void>
}

export interface SorobanTxSubmissionResult<TTransaction> {
	txHash: string
	sendStatus: SorobanAcceptedSendStatus
	transaction: TTransaction
}

export class SorobanSubmissionError extends Error {
	readonly code: SorobanSubmissionErrorCode
	readonly txHash?: string
	readonly errorResult?: unknown
	readonly errorResultXdr?: string

	constructor({
		code,
		message,
		txHash,
		errorResult,
		errorResultXdr,
		cause,
	}: {
		code: SorobanSubmissionErrorCode
		message: string
		txHash?: string
		errorResult?: unknown
		errorResultXdr?: string
		cause?: unknown
	}) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'SorobanSubmissionError'
		this.code = code
		this.txHash = txHash
		this.errorResult = errorResult
		this.errorResultXdr = errorResultXdr
	}
}

async function defaultSleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function pollForConfirmation<TGetTransactionResponse extends SorobanGetTransactionResponse>(
	server: Pick<SorobanTxServer<unknown, TGetTransactionResponse>, 'getTransaction'>,
	hash: string,
	options: Required<Pick<SubmitSorobanTxOptions, 'pollAttempts' | 'pollIntervalMs' | 'sleep'>>,
): Promise<Extract<TGetTransactionResponse, { status: 'SUCCESS' }>> {
	for (let attempt = 0; attempt < options.pollAttempts; attempt++) {
		let transaction: TGetTransactionResponse
		try {
			transaction = await server.getTransaction(hash)
		} catch (cause) {
			throw new SorobanSubmissionError({
				code: 'RPC_ERROR',
				message: `Failed to poll Soroban transaction ${hash}`,
				txHash: hash,
				cause,
			})
		}

		if (transaction.status === 'SUCCESS') {
			return transaction as Extract<TGetTransactionResponse, { status: 'SUCCESS' }>
		}

		if (transaction.status === 'FAILED') {
			throw new SorobanSubmissionError({
				code: 'TRANSACTION_FAILED',
				message: 'Soroban transaction failed on-chain',
				txHash: hash,
			})
		}

		if (attempt < options.pollAttempts - 1) {
			await options.sleep(options.pollIntervalMs)
		}
	}

	throw new SorobanSubmissionError({
		code: 'NOT_CONFIRMED',
		message: 'Soroban transaction not confirmed',
		txHash: hash,
	})
}

function getErrorResultXdr(errorResult: unknown): string | undefined {
	if (
		typeof errorResult !== 'object' ||
		errorResult === null ||
		!('toXDR' in errorResult) ||
		typeof errorResult.toXDR !== 'function'
	) {
		return undefined
	}

	return errorResult.toXDR('base64')
}

export async function submitSorobanTx<
	TTransaction,
	TGetTransactionResponse extends SorobanGetTransactionResponse,
>(
	server: SorobanTxServer<TTransaction, TGetTransactionResponse>,
	transaction: TTransaction,
	options: SubmitSorobanTxOptions = {},
): Promise<SorobanTxSubmissionResult<Extract<TGetTransactionResponse, { status: 'SUCCESS' }>>> {
	const sleep = options.sleep ?? defaultSleep
	const pollAttempts = options.pollAttempts ?? 60
	const pollIntervalMs = options.pollIntervalMs ?? 1000
	const retryAttempts = options.retryAttempts ?? 3
	const retryBackoffMs = options.retryBackoffMs ?? 1000
	let response = await server.sendTransaction(transaction)

	for (let retry = 0; ; retry++) {
		if (response.status === 'TRY_AGAIN_LATER') {
			if (retry >= retryAttempts) {
				throw new SorobanSubmissionError({
					code: 'TRY_AGAIN_LATER',
					message: 'Soroban RPC is busy. Rebuild the transaction with a higher fee.',
					txHash: response.hash,
				})
			}

			await sleep(retryBackoffMs * 2 ** retry)
			response = await server.sendTransaction(transaction)
			continue
		}

		if (response.status === 'ERROR') {
			let confirmationError: unknown
			try {
				const confirmed = await server.getTransaction(response.hash)
				if (confirmed.status === 'SUCCESS') {
					return {
						txHash: response.hash,
						sendStatus: response.status,
						transaction: confirmed as Extract<TGetTransactionResponse, { status: 'SUCCESS' }>,
					}
				}
			} catch (error) {
				confirmationError = error
			}

			throw new SorobanSubmissionError({
				code: 'RPC_ERROR',
				message: `Soroban RPC rejected the transaction: ${JSON.stringify(response)}`,
				txHash: response.hash,
				errorResult: response.errorResult,
				errorResultXdr: response.errorResultXdr ?? getErrorResultXdr(response.errorResult),
				cause: confirmationError,
			})
		}

		if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
			const confirmed = await pollForConfirmation(server, response.hash, {
				pollAttempts,
				pollIntervalMs,
				sleep,
			})
			return {
				txHash: response.hash,
				sendStatus: response.status,
				transaction: confirmed,
			}
		}
	}
}
