"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders an `otpauth://` provisioning URI as a scannable QR code.
 *
 * <h3>Why this is drawn in the browser and not on the server</h3>
 *
 * The QR encodes the shared secret, so it looks like something that ought to be produced where the
 * secret lives. It is not: the enrolment screen ALREADY displays that same secret in plain text for
 * manual entry, and offers it as a tappable `otpauth:` link. The client holds the secret either
 * way. Drawing the code here therefore adds no exposure that the surrounding panel does not already
 * have, while a server-rendered PNG would add a zxing dependency to auth-service and put a
 * base64 image of a live credential into a response body and every proxy log between the two.
 *
 * <h3>Failure is not fatal</h3>
 *
 * If generation fails the component renders nothing and the panel around it still shows the key and
 * the link, which is the path every authenticator app supports as its fallback. A QR that cannot be
 * drawn must not be allowed to block enrolment — this screen is the only way into the product for
 * the account looking at it.
 */
export function TotpQrCode({ otpauthUri }: { otpauthUri: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 200,
      // Fixed black-on-white regardless of theme. Scanners threshold on luminance, and a QR drawn
      // in the dark palette's foreground-on-background is routinely unreadable — the one place in
      // this product where honouring the user's theme makes the element stop working.
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  if (!dataUrl) return null;

  return (
    <div className="flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated in-browser;
          next/image would round-trip it through the optimiser for no benefit. */}
      <img
        src={dataUrl}
        alt="QR code for setting up two-factor authentication"
        width={200}
        height={200}
        className="rounded-lg border bg-white p-2"
        data-testid="totp-qr-code"
      />
    </div>
  );
}
