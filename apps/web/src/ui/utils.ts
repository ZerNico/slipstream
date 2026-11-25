import { createCn } from "cn/config";

/**
 * Joins class names and resolves Tailwind conflicts, knowing the app's own scale: the type
 * roles are sizes, so `text-meta` beside `text-fg-3` keeps both.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "h1",
            "h2",
            "h3",
            "body",
            "label",
            "meta",
            "caption",
            "eyebrow",
            "readout",
          ],
        },
      ],
    },
  },
});
