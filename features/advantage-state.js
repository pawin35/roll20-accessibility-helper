/**
 * Feature: make advantage / disadvantage audible.
 *
 * Roll20 shows advantage as a small icon next to a bonus. The icon is a
 * PolyIcon rendered as `<div role="img" aria-label="">` — an img role with an
 * empty name, which has no accessible name and does not fall back to its
 * content, so the state is completely silent.
 *
 * Where the state is recoverable it is fixed here. Roll20's bonus badge keeps
 * it in an attribute:
 *
 *   <div class="advantaged-number" data-advantage-mode="Advantage">
 *
 * so a hidden span mirroring that attribute lands inside the badge, and the
 * badge is already part of every roll button's name. Kept in sync with an
 * observer because — as with `data-prof` — the value exists nowhere as text.
 *
 * Deliberately NOT covered: the advantage icons on the ABILITIES Mod and Save
 * buttons. Those are rendered with the same class (`poly-icon--advantage`) for
 * both advantage and disadvantage, with nothing in the DOM distinguishing
 * them — only the inlined SVG differs. Announcing "with advantage" over a
 * disadvantage icon would be worse than the current silence, so they are left
 * alone until there is a signal worth trusting.
 */
(function () {
  "use strict";

  const { enhance, markOnce, hiddenSpan } = window.Roll20A11y;

  const SEL = "[data-advantage-mode]";
  const ATTR = "data-advantage-mode";

  // "Normal" is the overwhelmingly common case and adds nothing, so it stays
  // silent. An unrecognised value is also left silent rather than guessed at.
  const TEXT = {
    Advantage: "with advantage",
    Disadvantage: "with disadvantage",
  };

  enhance(SEL, (badge) => {
    if (!markOnce(badge, "advantage-state")) return;

    const mirror = hiddenSpan("");
    const sync = () => {
      mirror.textContent = TEXT[badge.getAttribute(ATTR)] || "";
    };
    sync();
    new MutationObserver(sync).observe(badge, {
      attributes: true,
      attributeFilter: [ATTR],
    });
    badge.appendChild(mirror);
  });
})();
