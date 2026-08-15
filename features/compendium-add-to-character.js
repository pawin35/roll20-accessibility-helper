/**
 * Feature: accessible "Add to Character" for Compendium search results.
 *
 * Roll20's character sheet page only lets you add a Compendium entry to a
 * character by dragging it onto the sheet. This adds a real button to every
 * result row that performs the same add, so it works with the keyboard and a
 * screen reader.
 *
 * Mechanism (reverse-engineered from Roll20's own client bundle,
 * enhanced-character-vault/main.js):
 *
 *   1. Each result row is `.compendium-page__upper[draggable="true"]`. Its own
 *      `dragstart` handler calls
 *      `dataTransfer.setData('page', JSON.stringify({id, name, book, category}))`,
 *      so we never have to reconstruct the payload ourselves.
 *
 *   2. That same `dragstart` bubbles up to the `CompendiumPanel` component,
 *      which emits `dragItemStart`. The root component flips a ref passed down
 *      as the `isPageBeingDragged` prop, and the drop target only exists
 *      behind that condition:
 *          isPageBeingDragged ? createBlock(CompendiumDropZone) : comment
 *      So `.compendium-dropzone` is NOT in the DOM until a dragstart fires,
 *      and a matching `dragend` unmounts it again.
 *
 *   3. The mounted dropzone's `drop` handler (`handleCompendiumDropItem`)
 *      reads `dataTransfer.getData('page')` and forwards
 *      {pageName, category, expansion} over a MessageChannel into the
 *      character-sheet iframe, which fetches full stats and saves the item.
 *
 * The subtlety that makes this work: Vue renders asynchronously, so the
 * dropzone is not present on the tick after `dragstart` — we must wait for it.
 * No mouse movement and no cross-origin scripting into the sheet iframe are
 * involved, only DOM events dispatched at specific elements.
 */
(function () {
  "use strict";

  const { announce, waitForElement, enhance, markOnce, createButton } =
    window.Roll20A11y;

  const SEL_ROW = ".compendium-page__upper[data-pagename]";
  const SEL_DROPZONE = ".compendium-dropzone";
  const SEL_CONTROLS = ".compendium-page__controls";
  const RESET_LABEL_MS = 1500;

  // --- Reading item data off a Compendium row -------------------------

  function extractItemInfo(row) {
    const rawPageName = row.getAttribute("data-pagename") || "";
    const expansionId = row.getAttribute("data-expansionid") || "";
    let pageName = "";
    try {
      // data-pagename looks like "Items%3ALongsword" — category, then name.
      const decoded = decodeURIComponent(rawPageName);
      const sep = decoded.indexOf(":");
      pageName = sep === -1 ? decoded : decoded.slice(sep + 1);
    } catch (e) {
      // Malformed value; leave empty so the caller skips this row.
    }

    const nameEl = row.querySelector('[data-testid="compendium-page-name"]');
    const sourceEl = row.querySelector('[data-testid="compendium-page-source-name"]');

    return {
      pageName,
      expansionId,
      displayName: (nameEl && nameEl.textContent.trim()) || pageName,
      sourceName: (sourceEl && sourceEl.textContent.trim()) || "",
    };
  }

  // --- Performing the add ----------------------------------------------

  // Must run on every path, including failures: leaving `isPageBeingDragged`
  // set keeps a stale dropzone mounted and breaks the next add.
  function endDrag(row, dataTransfer) {
    row.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer })
    );
  }

  async function addItemToCharacter(row) {
    // dragstart does double duty: the row's own handler fills in the "page"
    // payload, and the event bubbling to CompendiumPanel is what causes the
    // dropzone to be rendered at all.
    const dt = new DataTransfer();
    row.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt })
    );

    if (!dt.types.includes("page")) {
      endDrag(row, dt);
      return false;
    }

    // Vue renders asynchronously — the dropzone is not there yet.
    const zone = await waitForElement(SEL_DROPZONE);
    if (!zone) {
      endDrag(row, dt);
      return false;
    }

    const rect = zone.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };

    zone.dispatchEvent(new DragEvent("dragenter", opts));
    zone.dispatchEvent(new DragEvent("dragover", opts));
    zone.dispatchEvent(new DragEvent("drop", opts));
    endDrag(row, dt);
    return true;
  }

  // --- Wiring up the button --------------------------------------------

  async function handleActivate(btn, row, info) {
    if (btn.disabled) return;
    const original = btn.dataset.defaultLabel;
    btn.disabled = true;
    btn.textContent = "Adding…";

    let ok = false;
    try {
      ok = await addItemToCharacter(row);
    } catch (e) {
      ok = false;
    }

    if (ok) {
      btn.textContent = "Added ✓";
      announce(`${info.displayName} added to inventory.`);
    } else {
      btn.textContent = original;
      announce(
        `Couldn't add ${info.displayName}. Make sure the character sheet has ` +
          `finished loading, then try again.`
      );
    }

    window.setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, RESET_LABEL_MS);
  }

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "add-to-character")) return;

    const info = extractItemInfo(row);
    if (!info.pageName || !info.expansionId) return;

    const label = "Add to Character";
    const btn = createButton({
      label,
      ariaLabel: info.sourceName
        ? `Add ${info.displayName} (${info.sourceName}) to character inventory`
        : `Add ${info.displayName} to character inventory`,
      onActivate: (button) => handleActivate(button, row, info),
    });
    btn.dataset.defaultLabel = label;

    const controls =
      row.parentElement && row.parentElement.querySelector(SEL_CONTROLS);
    if (controls) {
      controls.insertAdjacentElement("beforebegin", btn);
    } else {
      row.insertAdjacentElement("afterend", btn);
    }
  });
})();
