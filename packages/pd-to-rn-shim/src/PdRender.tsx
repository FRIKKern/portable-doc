/**
 * PdRender — react-native wrapper. Native consumers (Expo / Metro).
 *
 * Walks an `RnNode` (produced by `toRn`) and materialises it as actual React
 * components from `react-native`. Mirror of `@portable-doc/backend-web/rnw`;
 * duplicated intentionally because the `react-native` vs `react-native-web`
 * import differs in production runtime even when the primitive surface matches.
 *
 * Lives next to the shim for v0.2.1 — the shim is the translation seam, the
 * RN-component re-export is the consumer-facing render shim. One package, two
 * tiny modules.
 */

import * as React from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — react-native ships its own types, but TS may not resolve them
// in this pure-data toolchain. Real consumers (Expo / Metro) get the types.
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { toRn } from './translate.js';
import type { RnNode } from './shape.js';
import type { PdNode } from '@portable-doc/primitives';

export interface PdRenderProps {
  tree: PdNode;
}

function renderNode(node: RnNode, key: string | number = 0): React.ReactElement {
  switch (node.component) {
    case 'View':
      return (
        <View key={key} style={node.style} accessibilityRole={node.accessibilityRole}>
          {node.children.map((c, i) => renderNode(c, i))}
        </View>
      );
    case 'Text':
      return (
        <Text key={key} style={node.style}>
          {node.children.map((c, i) =>
            typeof c === 'string' ? <React.Fragment key={i}>{c}</React.Fragment> : renderNode(c, i),
          )}
        </Text>
      );
    case 'Pressable': {
      const { href } = node;
      return (
        <Pressable
          key={key}
          accessibilityRole={node.accessibilityRole}
          onPress={() => {
            if (href) Linking.openURL(href);
          }}
        >
          {node.children.map((c, i) => renderNode(c, i))}
        </Pressable>
      );
    }
    case 'Image':
      return (
        <Image
          key={key}
          source={node.source}
          accessibilityLabel={node.accessibilityLabel}
          style={node.style}
        />
      );
  }
}

export function PdRender(props: PdRenderProps): React.ReactElement {
  return renderNode(toRn(props.tree));
}

export default PdRender;
