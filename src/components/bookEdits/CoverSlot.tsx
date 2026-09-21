import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CoverArt } from '@/components/shelf/CoverArt';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const PICK: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [2, 3], quality: 1 };

/** Tappable cover: Take photo / Choose from library / Remove photo. */
export function CoverSlot({
  id, title, coverUri, onPick, onRemove,
}: { id: string; title: string; coverUri: string | null; onPick: (uri: string) => void; onRemove: () => void }) {
  const { c } = useTheme();
  const [denied, setDenied] = useState<null | 'camera' | 'library'>(null);

  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setDenied('camera');
    const r = await ImagePicker.launchCameraAsync(PICK);
    if (!r.canceled) onPick(r.assets[0].uri);
  };
  const choose = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setDenied('library');
    const r = await ImagePicker.launchImageLibraryAsync(PICK);
    if (!r.canceled) onPick(r.assets[0].uri);
  };

  const open = () => {
    setDenied(null);
    const options = ['Take photo', 'Choose from library', ...(coverUri ? ['Remove photo'] : []), 'Cancel'];
    const run = (i: number) => (i === 0 ? take() : i === 1 ? choose() : coverUri && i === 2 ? onRemove() : undefined);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: coverUri ? 2 : undefined },
        run
      );
    } else {
      Alert.alert('Cover photo', undefined, options.slice(0, -1).map((text, i) => ({ text, onPress: () => run(i) })).concat({ text: 'Cancel', onPress: () => undefined }));
    }
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={coverUri ? 'Change cover photo' : 'Add a cover photo'}>
        <CoverArt id={id} title={title || 'Untitled'} coverUrl={coverUri} width={120} height={180} />
        <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textAlign: 'center', marginTop: 8, textDecorationLine: 'underline' }}>
          {coverUri ? 'Change photo' : 'Add a cover photo'}
        </Text>
      </Pressable>
      {denied ? (
        <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" style={{ marginTop: 6, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, textAlign: 'center' }}>
            {`Booklistd can't use your ${denied === 'camera' ? 'camera' : 'photos'}. Allow it in Settings.`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
