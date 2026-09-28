# Shared Browser Tab Claiming
- `browser.tabs.list()` lists tabs controlled by your browser session. Newly created tabs belong to that session automatically.
- To use an existing unclaimed tab, call `browser.user.openTabs()`, choose the returned tab by its title and URL, and pass that exact object to `browser.user.claimTab(tab)`. Reuse the returned `Tab` for browser operations.
- A tab can be controlled by only one browser session at a time. If a claim fails because another session controls it, choose another available tab or create one.
- Deliverable and unmarked user tabs are released when the turn ends. Handoff tabs can resume in your next turn unless another session has claimed them.
