import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const ICONS: Record<string, string> = {
  index: 'M4 4h4v16H4zM10 4h4v16h-4zM16 6l3.5-1 3 14.5-3.5 1z',
  search: 'M16 16l4 4',
  wishlist: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z',
  profile: 'M4 21c1-4 4-6 8-6s7 2 8 6',
};

function TabIcon({ name, color }: { name: string; color: string }) {
  return (
    <Svg width={24} height={24} fill="none" stroke={color} strokeWidth={2.2}>
      {name === 'search' ? <Circle cx={11} cy={11} r={6} /> : null}
      {name === 'profile' ? <Circle cx={12} cy={9} r={4} /> : null}
      <Path d={ICONS[name]} />
    </Svg>
  );
}

function ScanTabIcon() {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: -30, width: 65, height: 65 }}>
      <View style={{ position: 'absolute', left: 3, top: 3, width: 62, height: 62, borderRadius: 31, backgroundColor: c.line }} />
      <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: ink.bus, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={28} height={28} fill="none" stroke={ink.brown} strokeWidth={2.6}>
          <Path d="M5 9V5h4M19 5h4v4M23 19v4h-4M9 23H5v-4M8 14h12" />
        </Svg>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.soft,
        tabBarStyle: { backgroundColor: c.tabBar, borderTopColor: c.line, borderTopWidth: 2, height: 86, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: font.heavy, fontSize: 10.5 },
        sceneStyle: { backgroundColor: c.paper },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Shelves', tabBarIcon: ({ color }) => <TabIcon name="index" color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color }) => <TabIcon name="search" color={color} /> }} />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: 'Scan a book',
          tabBarIcon: () => <ScanTabIcon />,
          tabBarStyle: { display: 'none' }, // Store Mode is full-screen with its own close button
        }}
      />
      <Tabs.Screen name="wishlist" options={{ title: 'Wishlist', tabBarIcon: ({ color }) => <TabIcon name="wishlist" color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} /> }} />
    </Tabs>
  );
}
