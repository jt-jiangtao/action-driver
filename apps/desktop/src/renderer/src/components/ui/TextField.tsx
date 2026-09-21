import { useId, type ChangeEventHandler, type HTMLInputTypeAttribute } from 'react'
import { AppIcon } from './AppIcon'

export type TextFieldState =
  | 'default'
  | 'focused'
  | 'filled'
  | 'error'
  | 'success'
  | 'loading'
  | 'disabled'

export function TextField({
  label,
  testId,
  value,
  state = 'default',
  helper,
  placeholder,
  type = 'text',
  onChange
}: {
  label: string
  testId: string
  value: string
  state?: TextFieldState
  helper?: string
  placeholder?: string
  type?: HTMLInputTypeAttribute
  onChange: ChangeEventHandler<HTMLInputElement>
}) {
  const id = useId()
  const helperId = `${id}-helper`
  return (
    <label className="ui-text-field" htmlFor={id}>
      <span className="ui-text-field-label">{label}</span>
      <span className="ui-text-field-control" data-state={state}>
        <input
          aria-describedby={helper ? helperId : undefined}
          aria-invalid={state === 'error'}
          data-state={state}
          data-testid={testId}
          disabled={state === 'disabled'}
          id={id}
          onChange={onChange}
          placeholder={placeholder}
          type={type}
          value={value}
        />
        {state === 'loading' ? <AppIcon className="ui-spin" name="loader" /> : null}
        {state === 'success' ? <AppIcon name="check" /> : null}
        {state === 'error' ? <AppIcon name="circle-alert" /> : null}
      </span>
      {helper ? (
        <span className="ui-text-field-helper" data-state={state} id={helperId}>
          {helper}
        </span>
      ) : null}
    </label>
  )
}
