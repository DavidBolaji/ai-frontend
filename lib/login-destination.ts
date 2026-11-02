/** Keep login navigation on explicitly supported application routes. */
export function loginDestination(next: string | string[] | undefined): string {
  return typeof next === 'string' && ['/knowledge', '/chat', '/roadmap'].includes(next)
    ? next : '/knowledge';
}
