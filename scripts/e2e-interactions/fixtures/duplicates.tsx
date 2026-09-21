export const duplicates = (
  <>
    <div>Ordinary container</div>
    {true ? <button data-testid="e2e/home/header/action#button">One</button> : null}
    <button data-testid="e2e/home/header/action#button">Two</button>
  </>
)
