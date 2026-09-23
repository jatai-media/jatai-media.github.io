import '../shared/base.css';
import './hub.css';
import { applyTranslations } from '../i18n';
import { mountLangSwitchers } from '../shared/lang-switcher';
import { mountThemeToggles } from '../shared/theme';

mountLangSwitchers();
mountThemeToggles();
applyTranslations();
