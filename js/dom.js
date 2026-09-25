/**
 * dom.js — one helper for building page elements from JavaScript.
 *
 *   el(tag, properties, children)
 *
 * Every property is copied straight onto the new element, and the children
 * are placed inside it. So this:
 *
 *   el("li", { className: "done" }, [
 *     el("input", { type: "checkbox", checked: true }),
 *     el("span", { textContent: "Membean" }),
 *   ])
 *
 * builds the same thing as this HTML:
 *
 *   <li class="done">
 *     <input type="checkbox" checked>
 *     <span>Membean</span>
 *   </li>
 *
 * Useful properties: className, textContent, hidden, type, checked,
 * style ("width: 40%"), and event handlers such as onclick and onchange.
 * Children can be elements or plain strings.
 *
 * Always put text in through textContent (or as a string child), never
 * innerHTML. That way a title containing "<" or "&" is shown exactly as
 * written instead of being treated as HTML.
 */
function el(tag, properties = {}, children = []) {
  const element = document.createElement(tag);
  Object.assign(element, properties);
  element.append(...children);
  return element;
}
