/**
 * Feature: say what the attack buttons actually do.
 *
 * In the COMBAT tab's attack list, the roll controls announce their value with
 * no verb — "+3 Attack" and "1d10+1" — so there is nothing to distinguish a
 * button you press from a number you are being told.
 *
 *   +3 Attack  ->  Roll attack +3
 *   1d10+1     ->  Roll damage 1d10+1
 *
 * Damage is a straight prefix, so `aria-labelledby` can reference the button's
 * own live content. To-hit is not: the word "Attack" trails the number, and
 * putting the verb in front would leave "Roll attack +3 Attack". That one
 * needs the text rewritten, so it is mirrored into a hidden span and kept in
 * sync with an observer rather than copied once — a re-rolled or re-equipped
 * weapon changes the bonus, and a stale "+3" read confidently would be worse
 * than the original wording.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, labelFrom, hiddenSpan } = window.Roll20A11y;

  const SEL_ITEM = ".attack-item";
  const SEL_TO_HIT = ".poly-button--hit-dc";
  const SEL_DAMAGE = ".poly-button--damage, .poly-button--heal, .poly-button--healing";
  const SEL_BUTTON = ".poly-button__button";

  // "+3 Attack" -> "+3". Only a trailing "Attack" is removed; anything else
  // is left exactly as Roll20 wrote it.
  function bonusOnly(text) {
    return (text || "").trim().replace(/\s*Attack\s*$/i, "").trim();
  }

  function label(wrapper, verb, rewrite) {
    const button = wrapper.matches(SEL_BUTTON)
      ? wrapper
      : wrapper.querySelector(SEL_BUTTON);
    if (!button) return false;
    if ((button.getAttribute("aria-label") || "").trim()) return false;

    if (!rewrite) {
      // The button's own content is live, so reference it directly.
      labelFrom(button, [verb, button], wrapper);
      return true;
    }

    const mirror = hiddenSpan("");
    const sync = () => {
      mirror.textContent = verb + " " + bonusOnly(button.textContent);
    };
    sync();
    new MutationObserver(sync).observe(button, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    // Label-only, so it must not also be read as loose text in the row.
    mirror.setAttribute("aria-hidden", "true");
    wrapper.appendChild(mirror);
    labelFrom(button, [mirror], wrapper);
    return true;
  }

  let toHit = 0;
  let damage = 0;

  enhance(SEL_ITEM + " " + SEL_TO_HIT, (wrapper) => {
    if (!markOnce(wrapper, "attack-to-hit")) return;
    if (label(wrapper, "Roll attack", true)) toHit++;
  });

  enhance(SEL_ITEM + " " + SEL_DAMAGE, (wrapper) => {
    if (!markOnce(wrapper, "attack-damage")) return;
    // "Roll damage 1d10+1" — the heal variants read naturally with the same
    // verb, and their own content already says what they restore.
    if (label(wrapper, "Roll damage", false)) damage++;
  });

  window.setTimeout(() => {
    if (!toHit && !damage) return;
    debug("attacks", "to-hit buttons: " + toHit + ", damage buttons: " + damage);
  }, 4000);
})();
