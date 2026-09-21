declare const props: Record<string, unknown>

export const interactionKinds = (
  <>
    <button disabled type="button">Disabled</button>
    <div role="menuitem">Menu item</div>
    <div contentEditable>Editable</div>
    <button {...props} type="button">Spread cannot prove an id</button>
  </>
)
