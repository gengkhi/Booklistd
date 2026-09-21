import React from 'react';
import { View } from 'react-native';
import type { ShelfRow } from '@/lib/types';
import { createShelf } from '@/db/repository';
import { SUGGESTED_SHELVES } from '@/features/shelves/shelfRules';
import { Chip } from '@/components/ui/Chip';
import { useShelfNamePrompt } from './useShelfNamePrompt';

/** Pick a shelf; "+ New shelf" creates and selects one. With no shelves, suggestions create on tap. */
export function ShelfPicker({ shelves, selected, onSelect, onCreated }: {
  shelves: ShelfRow[]; selected: string | null; onSelect: (shelfId: string) => void; onCreated: (s: ShelfRow) => void;
}) {
  const prompt = useShelfNamePrompt();
  const create = (name: string) => {
    const s = createShelf(name);
    onCreated(s);
    onSelect(s.id);
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {shelves.length
        ? shelves.map((s) => <Chip key={s.id} label={s.name} selected={selected === s.id} onPress={() => onSelect(s.id)} />)
        : SUGGESTED_SHELVES.map((n) => <Chip key={n} label={n} onPress={() => create(n)} />)}
      <Chip label="+ New shelf" onPress={() => prompt.ask(create)} />
      {prompt.element}
    </View>
  );
}
