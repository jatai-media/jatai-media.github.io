import type { TranslationKey } from '../i18n';

export interface SizePreset {
  id: string;
  labelKey: TranslationKey;
  width: number;
  height: number;
}

/** Tamanhos prontos oferecidos no painel. Para adicionar um, inclua aqui e crie a tradução. */
export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: 'instagram-post', labelKey: 'editor.presets.instagramPost', width: 1080, height: 1080 },
  { id: 'instagram-portrait', labelKey: 'editor.presets.instagramPortrait', width: 1080, height: 1350 },
  { id: 'story', labelKey: 'editor.presets.story', width: 1080, height: 1920 },
  { id: 'facebook-post', labelKey: 'editor.presets.facebookPost', width: 1200, height: 630 },
  { id: 'x-post', labelKey: 'editor.presets.xPost', width: 1600, height: 900 },
  { id: 'linkedin-post', labelKey: 'editor.presets.linkedinPost', width: 1200, height: 627 },
  { id: 'youtube-thumbnail', labelKey: 'editor.presets.youtubeThumbnail', width: 1280, height: 720 },
  { id: 'presentation', labelKey: 'editor.presets.presentation', width: 1920, height: 1080 },
  { id: 'a4', labelKey: 'editor.presets.a4', width: 2480, height: 3508 },
];

export function findPreset(width: number, height: number): SizePreset | undefined {
  return SIZE_PRESETS.find((preset) => preset.width === width && preset.height === height);
}
