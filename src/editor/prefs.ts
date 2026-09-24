/** Preferências da sessão de edição compartilhadas entre os módulos do editor. */
export interface EditorPrefs {
  /** Mantém a proporção ao mudar largura/altura da tela. */
  lockAspect: boolean;
  /** Pincel da ferramenta Desenhar. */
  brush: {
    color: string;
    width: number;
    /** Traços seguidos entram na mesma camada de desenho. */
    merge: boolean;
  };
  /** Ponta da borracha/restaurar da imagem, em pixels da imagem. */
  imageBrushSize: number;
}

export const BRUSH_LIMITS = { min: 1, max: 200 } as const;
