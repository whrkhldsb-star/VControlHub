"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { getDomTextTranslation } from "@/lib/i18n/dom-translations";

type TranslatableNode = Text | HTMLElement;

const originalText = new WeakMap<TranslatableNode, string>();
const translatedAttrNames = ["aria-label", "title", "placeholder"] as const;

function isSkippableElement(element: Element | null) {
  if (!element) return true;
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "code", "pre", "textarea", "select", "option", "svg"].includes(tag)) return true;
  if (element.closest("[data-i18n-skip], code, pre, textarea, script, style, svg")) return true;
  return false;
}

function translateTextValue(value: string, locale: "zh" | "en") {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.trim();
  if (!core) return value;
  const exactTranslated = getDomTextTranslation(core, locale);
  if (exactTranslated !== core) return `${leading}${exactTranslated}${trailing}`;
  const translated = core.replace(/\S+|\s+/g, (part) => {
    if (/^\s+$/.test(part)) return part;
    const next = getDomTextTranslation(part, locale);
    return next === part ? part : next;
  });
  return translated === core ? value : `${leading}${translated}${trailing}`;
}

function localizeTextNode(node: Text, locale: "zh" | "en") {
  if (isSkippableElement(node.parentElement)) return;
  if (!originalText.has(node)) originalText.set(node, node.nodeValue ?? "");
  const source = originalText.get(node) ?? "";
  node.nodeValue = locale === "zh" ? source : translateTextValue(source, locale);
}

function localizeElementAttributes(element: HTMLElement, locale: "zh" | "en") {
  if (isSkippableElement(element)) return;
  for (const attr of translatedAttrNames) {
    const current = element.getAttribute(attr);
    if (!current) continue;
    const key = `data-i18n-original-${attr}`;
    if (!element.hasAttribute(key)) element.setAttribute(key, current);
    const source = element.getAttribute(key) ?? current;
    element.setAttribute(attr, locale === "zh" ? source : translateTextValue(source, locale));
  }
}

function localizeTree(root: ParentNode, locale: "zh" | "en") {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  if (!ownerDocument) return;

  if (root instanceof HTMLElement) localizeElementAttributes(root, locale);

  const elementWalker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let elementNode = elementWalker.nextNode();
  while (elementNode) {
    if (elementNode instanceof HTMLElement) localizeElementAttributes(elementNode, locale);
    elementNode = elementWalker.nextNode();
  }

  const textWalker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isSkippableElement(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let textNode = textWalker.nextNode();
  while (textNode) {
    localizeTextNode(textNode as Text, locale);
    textNode = textWalker.nextNode();
  }
}

export function DomI18nBridge() {
  const { locale } = useI18n();

  useEffect(() => {
    localizeTree(document.body, locale);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Text) localizeTextNode(node, locale);
          if (node instanceof HTMLElement) localizeTree(node, locale);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [locale]);

  return null;
}
