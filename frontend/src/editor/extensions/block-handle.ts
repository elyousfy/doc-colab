import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

const HANDLE_WIDTH = 24;
const TOP_LEVEL_NODES = new Set([
  "heading",
  "paragraph",
  "image",
  "table",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "docSection",
]);

function findBlockAtCoords(view: EditorView, y: number) {
  const { state } = view;
  const { doc } = state;

  // Scan top-level children
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const offset = doc.content.findIndex(i).offset;
    const pos = offset + 1;
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) continue;
    const rect = dom.getBoundingClientRect();

    if (y >= rect.top - 4 && y <= rect.bottom + 4) {
      // If it's a docSection, check if cursor is over one of its children
      if (child.type.name === "docSection") {
        for (let j = 0; j < child.childCount; j++) {
          const childOffset = child.content.findIndex(j).offset;
          const childPos = pos + childOffset;
          const childDom = view.nodeDOM(childPos);
          if (!(childDom instanceof HTMLElement)) continue;
          const childRect = childDom.getBoundingClientRect();
          if (y >= childRect.top - 4 && y <= childRect.bottom + 4) {
            return { node: child.child(j), pos: childPos, dom: childDom, rect: childRect };
          }
        }
      }
      return { node: child, pos: offset, dom, rect };
    }
  }
  return null;
}

/** Find the top-level block position for a cursor y coordinate, used for drop indicator. */
function findDropGap(view: EditorView, x: number, y: number): { top: number; pos: number } | null {
  const { doc } = view.state;
  const editorRect = view.dom.getBoundingClientRect();

  for (let i = 0; i < doc.childCount; i++) {
    const offset = doc.content.findIndex(i).offset;
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) continue;
    const rect = dom.getBoundingClientRect();
    const mid = (rect.top + rect.bottom) / 2;

    // Cursor is in the top half of this block → indicator goes above it
    if (y < mid && y >= rect.top - 20) {
      return { top: rect.top - editorRect.top - 2, pos: offset };
    }
    // Cursor is in the bottom half → indicator goes below it
    if (y >= mid && y <= rect.bottom + 20) {
      const node = doc.child(i);
      return { top: rect.bottom - editorRect.top + 2, pos: offset + node.nodeSize };
    }
  }
  return null;
}

function createHandleElement(): HTMLDivElement {
  const handle = document.createElement("div");
  handle.className = "block-handle";
  handle.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
    <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
    <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
  </svg>`;
  handle.setAttribute("draggable", "true");
  handle.setAttribute("data-block-handle", "true");
  return handle;
}

function createPlusElement(): HTMLDivElement {
  const plus = document.createElement("div");
  plus.className = "block-plus-button";
  plus.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
  </svg>`;
  plus.setAttribute("data-block-plus", "true");
  return plus;
}

function createActionMenu(): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "block-action-menu";
  menu.innerHTML = `
    <button data-action="duplicate" title="Duplicate block">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
    </button>
    <button data-action="delete" title="Delete block">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
    </button>
    <button data-action="moveUp" title="Move up">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
    </button>
    <button data-action="moveDown" title="Move down">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  `;
  return menu;
}

function createDropIndicator(): HTMLDivElement {
  const indicator = document.createElement("div");
  indicator.className = "block-drop-indicator";
  return indicator;
}

export const BlockHandle = Extension.create({
  name: "blockHandle",
  addProseMirrorPlugins() {
    let handle: HTMLDivElement | null = null;
    let plusBtn: HTMLDivElement | null = null;
    let actionMenu: HTMLDivElement | null = null;
    let dropIndicator: HTMLDivElement | null = null;
    let activeBlockPos: number | null = null;
    let menuOpen = false;

    const hideMenu = () => {
      if (actionMenu) actionMenu.classList.remove("visible");
      menuOpen = false;
    };

    const showHandleAt = (view: EditorView, block: NonNullable<ReturnType<typeof findBlockAtCoords>>) => {
      if (!handle) return;

      const editorRect = view.dom.getBoundingClientRect();
      const top = block.rect.top - editorRect.top;

      handle.style.top = `${top}px`;
      handle.style.opacity = "1";
      activeBlockPos = block.pos;

      block.dom.classList.add("block-hovered");
    };

    const hideHandle = (view: EditorView) => {
      if (!handle) return;
      handle.style.opacity = "0";
      if (!menuOpen) {
        view.dom.querySelectorAll(".block-hovered").forEach((el) =>
          el.classList.remove("block-hovered")
        );
      }
    };

    const showPlusAt = (view: EditorView, y: number) => {
      if (!plusBtn) return;
      const editorRect = view.dom.getBoundingClientRect();
      plusBtn.style.top = `${y - editorRect.top - 10}px`;
      plusBtn.style.opacity = "1";
    };

    const hidePlus = () => {
      if (!plusBtn) return;
      plusBtn.style.opacity = "0";
    };

    const hideDropIndicator = () => {
      if (dropIndicator) dropIndicator.style.opacity = "0";
    };

    const showDropIndicatorAt = (top: number) => {
      if (!dropIndicator) return;
      dropIndicator.style.top = `${top}px`;
      dropIndicator.style.opacity = "1";
    };

    return [
      new Plugin({
        key: new PluginKey("blockHandle"),
        view(editorView) {
          const wrapper = editorView.dom.parentElement;
          if (!wrapper) return {};

          wrapper.style.position = "relative";

          handle = createHandleElement();
          plusBtn = createPlusElement();
          actionMenu = createActionMenu();
          dropIndicator = createDropIndicator();

          wrapper.appendChild(handle);
          wrapper.appendChild(plusBtn);
          wrapper.appendChild(actionMenu);
          wrapper.appendChild(dropIndicator);

          handle.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!actionMenu || !handle) return;

            if (menuOpen) {
              hideMenu();
              return;
            }

            actionMenu.style.top = handle.style.top;
            actionMenu.style.left = `-${HANDLE_WIDTH + 100}px`;
            actionMenu.classList.add("visible");
            menuOpen = true;
          });

          handle.addEventListener("dragstart", (e) => {
            hideMenu();
            if (activeBlockPos === null) return;
            const { state } = editorView;
            const node = state.doc.nodeAt(activeBlockPos);
            if (!node) return;
            const slice = state.doc.slice(activeBlockPos, activeBlockPos + node.nodeSize);
            editorView.dragging = { slice, move: true };
            e.dataTransfer?.setDragImage(handle!, HANDLE_WIDTH / 2, HANDLE_WIDTH / 2);
          });

          // Track dragover on the editor to show drop indicator
          editorView.dom.addEventListener("dragover", (e) => {
            e.preventDefault();
            const gap = findDropGap(editorView, e.clientX, e.clientY);
            if (gap) {
              showDropIndicatorAt(gap.top);
            } else {
              hideDropIndicator();
            }
          });

          editorView.dom.addEventListener("dragleave", () => {
            hideDropIndicator();
          });

          editorView.dom.addEventListener("drop", () => {
            hideDropIndicator();
          });

          actionMenu.addEventListener("click", (e) => {
            const button = (e.target as HTMLElement).closest("button");
            if (!button || activeBlockPos === null) return;
            const action = button.getAttribute("data-action");
            const { state, dispatch } = editorView;
            const node = state.doc.nodeAt(activeBlockPos);
            if (!node) return;
            const nodeEnd = activeBlockPos + node.nodeSize;

            switch (action) {
              case "delete": {
                dispatch(state.tr.delete(activeBlockPos, nodeEnd));
                break;
              }
              case "duplicate": {
                dispatch(state.tr.insert(nodeEnd, node.copy(node.content)));
                break;
              }
              case "moveUp": {
                if (activeBlockPos === 0) break;
                const $pos = state.doc.resolve(activeBlockPos);
                const index = $pos.index($pos.depth);
                if (index === 0) break;
                const prevNode = state.doc.child(index - 1);
                const prevStart = activeBlockPos - prevNode.nodeSize;
                const tr = state.tr;
                tr.delete(activeBlockPos, nodeEnd);
                tr.insert(prevStart, node.copy(node.content));
                dispatch(tr);
                break;
              }
              case "moveDown": {
                const $pos2 = state.doc.resolve(activeBlockPos);
                const index2 = $pos2.index($pos2.depth);
                if (index2 >= state.doc.childCount - 1) break;
                const nextNode = state.doc.child(index2 + 1);
                const nextEnd = nodeEnd + nextNode.nodeSize;
                const tr2 = state.tr;
                tr2.insert(nextEnd, node.copy(node.content));
                tr2.delete(activeBlockPos, nodeEnd);
                dispatch(tr2);
                break;
              }
            }
            hideMenu();
          });

          plusBtn.addEventListener("click", (e) => {
            e.preventDefault();
            editorView.focus();
            const { state, dispatch } = editorView;
            const pType = state.schema.nodes.paragraph;
            if (!pType) return;
            const editorRect = editorView.dom.getBoundingClientRect();
            const clickY = parseFloat(plusBtn!.style.top) + editorRect.top + 10;
            const block = findBlockAtCoords(editorView, clickY + 10);
            if (block) {
              const insertPos = block.pos + block.node.nodeSize;
              dispatch(state.tr.insert(insertPos, pType.create()));
              editorView.focus();
              const newPos = insertPos + 1;
              editorView.dispatch(
                editorView.state.tr.setSelection(
                  editorView.state.selection.constructor.near(editorView.state.doc.resolve(newPos))
                )
              );
            }
          });

          return {
            destroy() {
              handle?.remove();
              plusBtn?.remove();
              actionMenu?.remove();
              dropIndicator?.remove();
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              const block = findBlockAtCoords(view, event.clientY);

              view.dom.querySelectorAll(".block-hovered").forEach((el) =>
                el.classList.remove("block-hovered")
              );

              if (block && TOP_LEVEL_NODES.has(block.node.type.name)) {
                showHandleAt(view, block);

                const rect = block.rect;
                const gap = rect.top - 4;
                if (event.clientY < rect.top && event.clientY > gap - 8) {
                  showPlusAt(view, gap);
                } else {
                  hidePlus();
                }
              } else {
                hideHandle(view);
                hidePlus();
              }
              return false;
            },
            mouseleave(view) {
              if (!menuOpen) {
                hideHandle(view);
              }
              hidePlus();
              return false;
            },
            click() {
              hideMenu();
              return false;
            },
          },
        },
      }),
    ];
  },
});
