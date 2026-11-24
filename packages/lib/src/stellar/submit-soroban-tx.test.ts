import { describe, expect, test } from 'bun:test'
import { type FeeBumpTransaction, rpc, type Transaction, xdr } from '@stellar/stellar-sdk'
import { SorobanSubmissionError, type SorobanTxServer, submitSorobanTx } from './submit-soroban-tx'

const transaction = {} as Transaction | FeeBumpTransaction
const noSleep = async () => {}

function sendResponse(status: rpc.Api.SendTransactionStatus, hash = 'tx-hash') {
	return {
		status,
		hash,
		latestLedger: 1,
		latestLedgerCloseTime: 1,
	} as rpc.Api.SendTransactionResponse
}

function successResponse(hash = 'tx-hash'): rpc.Api.GetSuccessfulTransactionResponse {
	return {
		status: rpc.Api.GetTransactionStatus.SUCCESS,
		txHash: hash,
		latestLedger: 2,
		latestLedgerCloseTime: 2,
		oldestLedger: 1,
		oldestLedgerCloseTime: 1,
		ledger: 2,
		createdAt: 2,
		applicationOrder: 0,
		feeBump: false,
		envelopeXdr: {} as rpc.Api.GetSuccessfulTransactionResponse['envelopeXdr'],
		resultXdr: {} as rpc.Api.GetSuccessfulTransactionResponse['resultXdr'],
		resultMetaXdr: {} as rpc.Api.GetSuccessfulTransactionResponse['resultMetaXdr'],
		events: {},
	} as rpc.Api.GetSuccessfulTransactionResponse
}

describe('submitSorobanTx', () => {
	test('attaches RPC error details', async () => {
		const errorResult = xdr.TransactionResult.fromXDR('AAAAAAAAAGT////7AAAAAA==', 'base64')
		const server: SorobanTxServer = {
			sendTransaction: async () =>
				({
					...sendResponse('ERROR'),
					errorResult,
				}) as rpc.Api.SendTransactionResponse,
			getTransaction: async () =>
				({
					status: rpc.Api.GetTransactionStatus.NOT_FOUND,
				}) as rpc.Api.GetMissingTransactionResponse,
		}

		try {
			await submitSorobanTx(server, transaction, { sleep: noSleep })
			throw new Error('Expected submission to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(SorobanSubmissionError)
			expect((error as SorobanSubmissionError).code).toBe('RPC_ERROR')
			expect((error as SorobanSubmissionError).errorResult).toBe(errorResult)
			expect((error as SorobanSubmissionError).errorResultXdr).toBe(errorResult.toXDR('base64'))
		}
	})

	test('retries TRY_AGAIN_LATER and confirms PENDING', async () => {
		let sends = 0
		const server: SorobanTxServer = {
			sendTransaction: async () => {
				sends++
				return sendResponse(sends === 1 ? 'TRY_AGAIN_LATER' : 'PENDING')
			},
			getTransaction: async () => successResponse(),
		}

		const result = await submitSorobanTx(server, transaction, {
			sleep: noSleep,
		})

		expect(sends).toBe(2)
		expect(result.sendStatus).toBe('PENDING')
		expect(result.transaction.status).toBe('SUCCESS')
	})

	test('polls DUPLICATE until SUCCESS', async () => {
		const server: SorobanTxServer = {
			sendTransaction: async () => sendResponse('DUPLICATE'),
			getTransaction: async () => successResponse(),
		}

		const result = await submitSorobanTx(server, transaction, {
			sleep: noSleep,
		})

		expect(result.sendStatus).toBe('DUPLICATE')
		expect(result.transaction.status).toBe('SUCCESS')
	})

	test('treats an ERROR resend as success when getTransaction is SUCCESS', async () => {
		let sends = 0
		const server: SorobanTxServer = {
			sendTransaction: async (submittedTransaction) => {
				expect(submittedTransaction).toBe(transaction)
				sends++
				return sendResponse(sends === 1 ? 'TRY_AGAIN_LATER' : 'ERROR')
			},
			getTransaction: async () => successResponse(),
		}

		const result = await submitSorobanTx(server, transaction, {
			sleep: noSleep,
		})

		expect(sends).toBe(2)
		expect(result.sendStatus).toBe('ERROR')
		expect(result.transaction.status).toBe('SUCCESS')
	})

	test('throws a rebuild guidance error after retry exhaustion', async () => {
		const server: SorobanTxServer = {
			sendTransaction: async () => sendResponse('TRY_AGAIN_LATER'),
			getTransaction: async () =>
				({
					status: rpc.Api.GetTransactionStatus.NOT_FOUND,
				}) as rpc.Api.GetMissingTransactionResponse,
		}

		try {
			await submitSorobanTx(server, transaction, {
				retryAttempts: 1,
				sleep: noSleep,
			})
			throw new Error('Expected submission to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(SorobanSubmissionError)
			expect((error as SorobanSubmissionError).code).toBe('TRY_AGAIN_LATER')
			expect((error as Error).message).toContain('higher fee')
		}
	})

	test('throws NOT_CONFIRMED when polling stays NOT_FOUND', async () => {
		const server: SorobanTxServer = {
			sendTransaction: async () => sendResponse('PENDING'),
			getTransaction: async () =>
				({
					status: rpc.Api.GetTransactionStatus.NOT_FOUND,
				}) as rpc.Api.GetMissingTransactionResponse,
		}

		try {
			await submitSorobanTx(server, transaction, {
				pollAttempts: 2,
				sleep: noSleep,
			})
			throw new Error('Expected submission to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(SorobanSubmissionError)
			expect((error as SorobanSubmissionError).code).toBe('NOT_CONFIRMED')
			expect((error as SorobanSubmissionError).txHash).toBe('tx-hash')
		}
	})
})
