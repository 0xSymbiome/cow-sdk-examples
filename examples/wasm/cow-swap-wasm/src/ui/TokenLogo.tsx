import { useState } from 'react'

import type { TokenInfo } from '../tokens/tokens'

export function TokenLogo({ token, size = 28 }: { token: TokenInfo; size?: number }) {
  const [errored, setErrored] = useState(false)
  const src =
    token.logoURI ??
    `https://files.cow.fi/token-lists/images/${token.chainId}/${token.address}/logo.png`

  if (errored) {
    return (
      <span className="token-logo token-logo-fallback" style={{ width: size, height: size }}>
        {token.symbol.slice(0, 3)}
      </span>
    )
  }

  return (
    <img
      className="token-logo"
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
    />
  )
}
