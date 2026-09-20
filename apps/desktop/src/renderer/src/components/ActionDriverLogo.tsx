import actionDriverLogo from '../../../../../../design/assets/actiondriver-logo.svg'

export function ActionDriverLogo({ size = 24 }: { size?: number }) {
  return (
    <img
      alt="ActionDriver"
      className="ad-logo"
      draggable={false}
      height={size}
      src={actionDriverLogo}
      width={size}
    />
  )
}
