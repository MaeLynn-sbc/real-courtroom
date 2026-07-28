interface ContactFallbackLinksProps {
  phone: string;
  facebookUrl: string;
}

// The clickable half of a "contact us" sentence — callers supply their
// own lead-in text and wrap this inline. Extracted so the same Facebook/
// phone fallback shown below the GCash upload can also be reused for the
// coach add-on's post-payment locked message, instead of two independent
// copies of the same link markup.
export function ContactFallbackLinks({ phone, facebookUrl }: ContactFallbackLinksProps) {
  if (!phone && !facebookUrl) {
    return null;
  }
  return (
    <>
      {facebookUrl ? (
        <a href={facebookUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Message us on Facebook
        </a>
      ) : null}
      {facebookUrl && phone ? " or call " : null}
      {!facebookUrl && phone ? "Call " : null}
      {phone}
    </>
  );
}
