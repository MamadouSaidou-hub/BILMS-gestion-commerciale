export const businessConfig = {
  currency: 'GNF',
  unit: {
    baseSingular: 'Pièce',
    basePlural: 'Pièces',
    baseSingularLower: 'pièce',
    basePluralLower: 'pièces',
    bulkLabel: 'Carton',
    // Reste à 1 : contrairement à la farine (kg -> tonne, un ratio physique universel), le nombre de
    // pièces par carton varie selon le produit, donc c'est le champ par-produit (équivalent de
    // sackWeightKg) qui porte la vraie conversion — voir lib/db/seed.ts pour les valeurs par produit.
    bulkConversionFactor: 1,
  },
}
