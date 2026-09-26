// Ponto de entrada do editor de video.
//
// No jat.ai em C++ a interface era um script so, montado na ordem de
// ui/index.html. Aqui cada arquivo e um modulo, mas a ordem de importacao e a
// mesma - e `ui/main` continua por ultimo, porque e ele que da a partida.

import './ui/base.css';
import './ui/dock.css';
import './ui/panels.css';
import './ui/timeline.css';

import './ui/core';
import './ui/dialogo';
import './ui/menu';
import './ui/exportar';
import './ui/projeto';
import './ui/panels';
import './ui/dock-tree';
import './ui/dock-view';
import './ui/panel-media';
import './ui/panel-player';
import './ui/panel-audio';
import './ui/panel-props';
import './ui/panel-imagem';
import './ui/texto';
import './ui/panel-narrador';
import './ui/panel-efeitos';
import './ui/tela-inicial';
import './ui/panel-timeline';
import './ui/atalhos';
import './ui/prefs';
import './ui/main';
