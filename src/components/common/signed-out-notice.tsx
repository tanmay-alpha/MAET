/** Explains that a section needs an account, instead of showing an empty state or a raw 401. */
export function SignedOutNotice({ feature }: { feature: string }) {
  return (
    <p role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
      {feature} require a signed-in account. Sign-in is coming soon.
    </p>
  );
}
