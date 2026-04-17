import { act, renderHook, waitFor } from '@testing-library/react';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { usePractitionerVerifiedTotpCount } from './use-practitioner-verified-totp';

jest.mock('@abstrack/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(),
}));

const mockedGetClient = jest.mocked(getSupabaseBrowserClient);

function listFactorsResult(verifiedCount: number) {
  const totp = Array.from({ length: verifiedCount }, (_, i) => ({
    id: `factor-${i}`,
    status: 'verified' as const,
  }));
  return { error: null as const, data: { totp } };
}

describe('usePractitionerVerifiedTotpCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not apply refresh results after enabled becomes false while the request is in flight', async () => {
    let finishRefresh!: (v: ReturnType<typeof listFactorsResult>) => void;
    const refreshPromise = new Promise<ReturnType<typeof listFactorsResult>>(
      (resolve) => {
        finishRefresh = resolve;
      },
    );

    const listFactors = jest
      .fn()
      .mockResolvedValueOnce(listFactorsResult(0))
      .mockImplementationOnce(() => refreshPromise);

    mockedGetClient.mockReturnValue({
      auth: { mfa: { listFactors } },
    } as never);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePractitionerVerifiedTotpCount(enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.verifiedTotpCount).toBe(0);

    await act(async () => {
      const p = result.current.refresh();
      rerender({ enabled: false });
      finishRefresh(listFactorsResult(3));
      await p;
    });

    expect(result.current.verifiedTotpCount).toBe(0);
    expect(result.current.error).toBeNull();
  });
});
