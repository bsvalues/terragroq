/**
 * `next/cache`, for a process that is not Next.
 *
 * `app/actions/authority.ts` ends by calling `revalidatePath("/goal-console")` and
 * `revalidatePath("/work-orders")`. That call invalidates the RENDER CACHE of a running Next server
 * so the next request re-fetches. There is no Next server in this process and no cache to
 * invalidate, so doing nothing is the correct behaviour rather than a stubbed-out one -- and the
 * real function throws outside a request context, which would abort the transaction's caller after
 * the grant had already been committed.
 *
 * It records that it was called, so the evidence can show these were the only two Next seams and
 * that neither of them touches the grant.
 */
export const revalidatePathCalls = []

export function revalidatePath(pathname, type) {
  revalidatePathCalls.push({ pathname, type: type ?? null })
}

export function revalidateTag(tag) {
  revalidatePathCalls.push({ tag })
}

export function unstable_cache(fn) {
  return fn
}
