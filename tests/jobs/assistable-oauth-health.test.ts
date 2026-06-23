import { describe, expect, it, vi } from 'vitest';

describe('runAssistableOAuthHealth', () => {
    it('proposes refresh-oauth for each disconnected account', async () => {
        vi.resetModules();

        const refreshExecute = vi.fn().mockResolvedValue({
            mode: 'api',
            accountId: 'a1000000-0000-0000-0000-000000000001',
            accountName: 'Test Account',
            assistableLocationId: 'loc-1',
            locationSource: 'assistable-subaccount-id',
            previousStatus: 'disconnected',
            currentStatus: 'connected',
            refreshedAt: '2026-06-24T10:00:00.000Z',
        });

        const registry = {
            get: vi.fn((id: string) => {
                if (id === 'assistable.check-oauth-status') {
                    return {
                        execute: vi.fn().mockResolvedValue({
                            checkedAt: '2026-06-24T10:00:00.000Z',
                            summary: { total: 2, connected: 0, disconnected: 2, needsAttention: 2 },
                            results: [
                                { accountId: 'a1000000-0000-0000-0000-000000000001', accountName: 'Account One', status: 'disconnected' },
                                { accountId: 'a2000000-0000-0000-0000-000000000002', accountName: 'Account Two', status: 'disconnected' },
                            ],
                        }),
                    };
                }
                if (id === 'assistable.refresh-oauth') {
                    return { execute: refreshExecute };
                }
                if (id === 'slack.post-message') {
                    return { execute: vi.fn().mockResolvedValue({ ts: '1234.5678' }) };
                }
                throw new Error(`unexpected skill ${id}`);
            }),
        };

        vi.doMock('../../src/lib/db/client.js', () => ({
            query: vi.fn().mockResolvedValue({ rows: [] }),
        }));

        const { runAssistableOAuthHealth } = await import(
            '../../src/jobs/assistable-oauth-health.js'
        );
        await runAssistableOAuthHealth(registry as never);

        expect(refreshExecute).toHaveBeenCalledTimes(2);
        expect(refreshExecute.mock.calls[0]?.[0]).toMatchObject({ accountId: 'a1000000-0000-0000-0000-000000000001' });
        expect(refreshExecute.mock.calls[1]?.[0]).toMatchObject({ accountId: 'a2000000-0000-0000-0000-000000000002' });

        vi.doUnmock('../../src/lib/db/client.js');
    });

    it('proposes refresh-oauth for each auth-error account', async () => {
        vi.resetModules();

        const refreshExecute = vi.fn().mockResolvedValue({
            mode: 'api',
            accountId: 'a3000000-0000-0000-0000-000000000003',
            accountName: 'Account Three',
            assistableLocationId: 'loc-3',
            locationSource: 'assistable-subaccount-id',
            previousStatus: 'auth-error',
            currentStatus: 'connected',
            refreshedAt: '2026-06-24T10:00:00.000Z',
        });

        const registry = {
            get: vi.fn((id: string) => {
                if (id === 'assistable.check-oauth-status') {
                    return {
                        execute: vi.fn().mockResolvedValue({
                            checkedAt: '2026-06-24T10:00:00.000Z',
                            summary: { total: 1, connected: 0, authError: 1, needsAttention: 1 },
                            results: [
                                { accountId: 'a3000000-0000-0000-0000-000000000003', accountName: 'Account Three', status: 'auth-error' },
                            ],
                        }),
                    };
                }
                if (id === 'assistable.refresh-oauth') {
                    return { execute: refreshExecute };
                }
                if (id === 'slack.post-message') {
                    return { execute: vi.fn().mockResolvedValue({ ts: '1234.5678' }) };
                }
                throw new Error(`unexpected skill ${id}`);
            }),
        };

        vi.doMock('../../src/lib/db/client.js', () => ({
            query: vi.fn().mockResolvedValue({ rows: [] }),
        }));

        const { runAssistableOAuthHealth } = await import(
            '../../src/jobs/assistable-oauth-health.js'
        );
        await runAssistableOAuthHealth(registry as never);

        expect(refreshExecute).toHaveBeenCalledTimes(1);
        expect(refreshExecute.mock.calls[0]?.[0]).toMatchObject({ accountId: 'a3000000-0000-0000-0000-000000000003' });

        vi.doUnmock('../../src/lib/db/client.js');
    });

    it('does not propose refresh-oauth when all accounts are connected', async () => {
        vi.resetModules();

        const refreshExecute = vi.fn();

        const registry = {
            get: vi.fn((id: string) => {
                if (id === 'assistable.check-oauth-status') {
                    return {
                        execute: vi.fn().mockResolvedValue({
                            checkedAt: '2026-06-24T10:00:00.000Z',
                            summary: { total: 2, connected: 2, needsAttention: 0 },
                            results: [
                                { accountId: 'a4000000-0000-0000-0000-000000000004', accountName: 'Account Four', status: 'connected' },
                                { accountId: 'a5000000-0000-0000-0000-000000000005', accountName: 'Account Five', status: 'connected' },
                            ],
                        }),
                    };
                }
                if (id === 'assistable.refresh-oauth') {
                    return { execute: refreshExecute };
                }
                if (id === 'slack.post-message') {
                    return { execute: vi.fn().mockResolvedValue({ ts: '1234.5678' }) };
                }
                throw new Error(`unexpected skill ${id}`);
            }),
        };

        vi.doMock('../../src/lib/db/client.js', () => ({
            query: vi.fn().mockResolvedValue({ rows: [] }),
        }));

        const { runAssistableOAuthHealth } = await import(
            '../../src/jobs/assistable-oauth-health.js'
        );
        await runAssistableOAuthHealth(registry as never);

        expect(refreshExecute).not.toHaveBeenCalled();

        vi.doUnmock('../../src/lib/db/client.js');
    });

    it('does not propose refresh-oauth for not_found, missing-subaccount-id, or unreachable accounts', async () => {
        vi.resetModules();

        const refreshExecute = vi.fn();

        const registry = {
            get: vi.fn((id: string) => {
                if (id === 'assistable.check-oauth-status') {
                    return {
                        execute: vi.fn().mockResolvedValue({
                            checkedAt: '2026-06-24T10:00:00.000Z',
                            summary: { total: 3, notFound: 1, missingSubaccountId: 1, unreachable: 1, needsAttention: 3 },
                            results: [
                                { accountId: 'a6000000-0000-0000-0000-000000000006', accountName: 'Account Six', status: 'not_found' },
                                { accountId: 'a7000000-0000-0000-0000-000000000007', accountName: 'Account Seven', status: 'missing-subaccount-id' },
                                { accountId: 'a8000000-0000-0000-0000-000000000008', accountName: 'Account Eight', status: 'unreachable' },
                            ],
                        }),
                    };
                }
                if (id === 'assistable.refresh-oauth') {
                    return { execute: refreshExecute };
                }
                if (id === 'slack.post-message') {
                    return { execute: vi.fn().mockResolvedValue({ ts: '1234.5678' }) };
                }
                throw new Error(`unexpected skill ${id}`);
            }),
        };

        vi.doMock('../../src/lib/db/client.js', () => ({
            query: vi.fn().mockResolvedValue({ rows: [] }),
        }));

        const { runAssistableOAuthHealth } = await import(
            '../../src/jobs/assistable-oauth-health.js'
        );
        await runAssistableOAuthHealth(registry as never);

        expect(refreshExecute).not.toHaveBeenCalled();

        vi.doUnmock('../../src/lib/db/client.js');
    });
});