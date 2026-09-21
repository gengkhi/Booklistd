import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { Reading, ReadingState } from '@/lib/types';
import { canRate, formatShortDate, isoToDate, READING_LABEL, READING_STATES, todayIso } from '@/features/reading/readingLogic';
import { RatingBadge } from '@/components/rating/RatingBadge';
import { Chip } from '@/components/ui/Chip';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

function DateField({ label, value, today, min, onChange }: {
  label: string; value: string | null; today: string; min?: string | null; onChange: (iso: string) => void;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const text = { fontFamily: font.heavy, fontSize: 13, color: c.text };
  if (!value) {
    return (
      <Pressable onPress={() => onChange(today)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={[text, { textDecorationLine: 'underline' }]}>{`Add ${label.toLowerCase()} date`}</Text>
      </Pressable>
    );
  }
  const picker = (
    <DateTimePicker
      value={isoToDate(value)}
      mode="date"
      accessibilityLabel={`${label} date`}
      display={Platform.OS === 'ios' ? 'compact' : 'default'}
      maximumDate={isoToDate(today)}
      minimumDate={min ? isoToDate(min) : undefined}
      onChange={(e: DateTimePickerEvent, d?: Date) => {
        setOpen(false);
        if (e.type === 'set' && d) onChange(todayIso(d));
      }}
    />
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <Text style={text}>{label}</Text>
      {Platform.OS === 'ios' ? picker : (
        <>
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label} ${value}. Change date`} hitSlop={8}>
            <Text style={[text, { textDecorationLine: 'underline' }]}>{formatShortDate(value, today)}</Text>
          </Pressable>
          {open ? picker : null}
        </>
      )}
    </View>
  );
}

/** Reading row on book detail: the four states, the dates, and the Dewey rating. */
export function ReadingControls({ reading, today, onState, onDates, onRate }: {
  reading: Reading | null;
  today: string;
  onState: (s: ReadingState) => void;
  onDates: (d: { startedAt?: string | null; finishedAt?: string | null }) => void;
  onRate: () => void;
}) {
  const { c } = useTheme();
  const state = reading?.state ?? null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 18 }}>
      <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text, marginBottom: 8 }}>Reading</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {READING_STATES.map((s) => (
          <Chip key={s} label={READING_LABEL[s]} selected={state === s} onPress={() => onState(s)} />
        ))}
      </View>
      {reading && state !== 'want' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, marginTop: 10 }}>
          <DateField label="Started" value={reading.startedAt} today={today} onChange={(iso) => onDates({ startedAt: iso })} />
          {canRate(reading.state) ? (
            <DateField label="Finished" value={reading.finishedAt} today={today} min={reading.startedAt} onChange={(iso) => onDates({ finishedAt: iso })} />
          ) : null}
        </View>
      ) : null}
      {reading && canRate(reading.state) ? (
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          {reading.rating ? (
            <RatingBadge rating={reading.rating} onPress={onRate} />
          ) : (
            <Pressable onPress={onRate} accessibilityRole="button" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={{ height: 32, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>Rate it</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}
