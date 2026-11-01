import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  defaultTemplateFor,
  findTemplate,
  newTemplateId,
  templateListSchema,
  templatesFor,
} from '../../src/shared/templates';

describe('modèles par défaut', () => {
  it.each([
    ['procedure', ['Prérequis', 'Étapes', 'Vérification', 'Retour arrière']],
    [
      'component',
      [
        'Rôle',
        'Responsabilités',
        'Dépendances',
        'Configuration',
        'Points d’attention',
      ],
    ],
    ['data', ['Schéma', 'Origine', 'Consommateurs']],
    ['adr', ['Contexte', 'Décision', 'Conséquences', 'Alternatives']],
  ])('%s contient ses sections', (id, sections) => {
    const template = findTemplate(DEFAULT_TEMPLATES, id)!;
    expect(
      template.body
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3)),
    ).toEqual(sections);
  });

  it('sont valides', () => {
    expect(templateListSchema.safeParse(DEFAULT_TEMPLATES).success).toBe(true);
  });
});

describe('choix d’un modèle', () => {
  it('propose ceux du type d’abord', () => {
    const { own, others } = templatesFor(DEFAULT_TEMPLATES, 'data');
    expect(own.map((t) => t.id)).toEqual(['data']);
    expect(others).toHaveLength(3);
    expect(defaultTemplateFor(DEFAULT_TEMPLATES, 'concept')?.id).toBe('adr');
    expect(defaultTemplateFor(DEFAULT_TEMPLATES, 'resource')).toBeNull();
  });

  it('trouve un modèle par identifiant ou par nom', () => {
    expect(findTemplate(DEFAULT_TEMPLATES, ' DONNÉE ')?.id).toBe('data');
    expect(findTemplate(DEFAULT_TEMPLATES, 'inconnu')).toBeNull();
  });
});

describe('newTemplateId', () => {
  it('dérive un identifiant libre du nom', () => {
    expect(newTemplateId(DEFAULT_TEMPLATES, 'Réunion d’équipe')).toBe(
      'reunion-d-equipe',
    );
    expect(newTemplateId(DEFAULT_TEMPLATES, 'Procédure')).toBe('procedure-2');
    expect(newTemplateId([], '!!!')).toBe('modele');
  });
});

describe('templateListSchema', () => {
  const base = DEFAULT_TEMPLATES[0]!;

  it('refuse les noms en double (sans casse) et les identifiants invalides', () => {
    expect(
      templateListSchema.safeParse([
        base,
        { ...base, id: 'autre', name: 'PROCÉDURE' },
      ]).success,
    ).toBe(false);
    expect(
      templateListSchema.safeParse([{ ...base, id: 'Avec Espace' }]).success,
    ).toBe(false);
    expect(
      templateListSchema.safeParse([{ ...base, name: '  ' }]).success,
    ).toBe(false);
  });
});
