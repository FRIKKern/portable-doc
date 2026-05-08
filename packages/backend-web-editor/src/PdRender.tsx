/**
 * PdRender — react-native-web wrapper. Editor-only.
 *
 * Walks an `RnNode` (produced by `@portable-doc/pd-to-rn-shim`) and
 * materialises it as actual React components from `react-native-web`. Lazy
 * loaded by the editor app's Web preview tab so RNW (~3MB) doesn't bloat
 * cold start (spec §6 / grill Q5).
 */

import * as React from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — react-native-web has its own types, but TS may not resolve them in pure-data toolchain.
import { Image, Linking, Pressable, Text, View } from 'react-native-web';
import { toRn } from '@portable-doc/pd-to-rn-shim';
import type { RnNode } from '@portable-doc/pd-to-rn-shim';
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
