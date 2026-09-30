import productLogo from '../../../../../../design/assets/action-driver-logo.svg'

export function ProductLogo({ size = 24 }: { size?: number }) {
  return (
    <img
      alt="Action-Driver"
      className="ad-logo"
      draggable={false}
      height={size}
      src={productLogo}
      width={size}
    />
  )
}
