import type { ReactElement } from "react";
import { FlatList, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { CARD_EM, CARD_GAP_EM, CARD_LIFT_ROOM } from "./rail-metrics.ts";

/**
 * A row of TV cards running to the screen's right edge (Home, Recordings, a show's seasons,
 * Search): every card the same width, so the list only draws the cards near the view and knows
 * where each one is without measuring. A focused card scrolls into view and has room to lift
 * (`CARD_LIFT_ROOM`). `footer` ends the row (a show's "See all" card).
 */
export const CardRow = <T,>({
  items,
  keyOf,
  renderCard,
  footer,
}: {
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  readonly renderCard: (item: T, index: number) => ReactElement;
  readonly footer?: ReactElement | undefined;
}) => {
  const { em } = useTheme();
  const stride = (CARD_EM + CARD_GAP_EM) * em;
  const pad = CARD_LIFT_ROOM * em;
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={keyOf}
      renderItem={({ item, index }) => (
        <View style={{ width: stride }}>{renderCard(item, index)}</View>
      )}
      getItemLayout={(_, index) => ({ length: stride, offset: pad + stride * index, index })}
      ListFooterComponent={footer}
      initialNumToRender={8}
      windowSize={5}
      // Detached cards cannot take focus; the window already keeps the row light.
      removeClippedSubviews={false}
      showsHorizontalScrollIndicator={false}
      // Rows run to the screen's edge, past the page's right margin.
      style={{ marginRight: -4 * em }}
      contentContainerStyle={{ padding: pad, paddingRight: 4 * em }}
    />
  );
};
