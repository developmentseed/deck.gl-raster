// Adds `/` as a shortcut to focus the navbar search bar, complementing
// the `Cmd/Ctrl+K` shortcut provided natively by @easyops-cn/docusaurus-search-local.

if (typeof window !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    const input = document.querySelector<HTMLInputElement>(
      ".navbar__search-input",
    );
    if (input) {
      event.preventDefault();
      input.focus();
    }
  });
}
