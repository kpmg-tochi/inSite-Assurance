import { z } from 'zod';

/**
 * Redesign R2a: the tenant facility catalogue (spec section 5 and 6.2). Every BoQ line belongs to a
 * facility unit, and every unit is an instance of a catalogue facility. The archetype decides which
 * default sub-form a facility starts from (R3) and whether its units carry a planned quantity.
 */

export const FacilityArchetypeEnum = z.enum(['BUILDING_WORKS', 'SUPPLY_INSTALLATION', 'UTILITIES', 'EXTERNAL_WORKS']);
export type FacilityArchetype = z.infer<typeof FacilityArchetypeEnum>;

export const FACILITY_ARCHETYPE_META: Record<
  FacilityArchetype,
  { label: string; description: string; /** Units carry a planned quantity (e.g. 120 desks). */ quantityBased: boolean }
> = {
  BUILDING_WORKS: {
    label: 'Building works',
    description: 'Buildings and rooms: classrooms, toilets, offices, hostels.',
    quantityBased: false,
  },
  SUPPLY_INSTALLATION: {
    label: 'Supply & installation',
    description: 'Furniture, equipment and kits, delivered against a planned quantity.',
    quantityBased: true,
  },
  UTILITIES: {
    label: 'Utilities',
    description: 'Water and power: boreholes, tanks, generators, solar.',
    quantityBased: false,
  },
  EXTERNAL_WORKS: {
    label: 'External works',
    description: 'Fences, drainage, landscaping, pitches and playgrounds.',
    quantityBased: false,
  },
};

/** Codes are upper snake case and immutable once a unit uses them. */
export const FACILITY_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,39}$/;

export interface DefaultFacilityDefinition {
  code: string;
  name: string;
  category: string;
  archetype: FacilityArchetype;
  /** Irregular or uncountable plural for {facility} (R3, D-R3.9). */
  pluralName?: string;
}

const building = (code: string, name: string): DefaultFacilityDefinition => ({ code, name, category: 'Buildings', archetype: 'BUILDING_WORKS' });
const furniture = (code: string, name: string): DefaultFacilityDefinition => ({ code, name, category: 'Furniture', archetype: 'SUPPLY_INSTALLATION' });
const equipment = (code: string, name: string): DefaultFacilityDefinition => ({ code, name, category: 'Equipment', archetype: 'SUPPLY_INSTALLATION' });
const utility = (code: string, name: string): DefaultFacilityDefinition => ({ code, name, category: 'Utilities', archetype: 'UTILITIES' });
const external = (code: string, name: string): DefaultFacilityDefinition => ({ code, name, category: 'External works', archetype: 'EXTERNAL_WORKS' });

/** The 50 facilities every tenant starts with (spec 6.2): 19 building, 22 supply, 4 utilities, 5 external. */
export const DEFAULT_FACILITIES: DefaultFacilityDefinition[] = [
  building('CLASSROOM', 'Classroom'),
  building('OFFICE', 'Office'),
  building('STORE', 'Store'),
  building('TOILET', 'Toilet'),
  building('LABORATORY', 'Laboratory'),
  building('WORKSHOP', 'Workshop'),
  building('LIBRARY', 'Library'),
  building('ICT_LAB', 'ICT lab'),
  building('HALL', 'Hall'),
  building('ADMIN_BLOCK', 'Admin block'),
  { ...building('STAFF_QUARTERS', 'Staff quarters'), pluralName: 'Staff quarters' },
  building('STAFF_ROOM', 'Staff room'),
  building('HOSTEL', 'Hostel'),
  building('CLINIC', 'Clinic'),
  building('KITCHEN', 'Kitchen'),
  building('SHOP', 'Shop'),
  building('CRECHE', 'Crèche'),
  building('GATE_HOUSE', 'Gate house'),
  building('NANNY_STATION', 'Nanny station'),
  furniture('PUPILS_FURNITURE', "Pupils' furniture"),
  furniture('TEACHERS_FURNITURE', "Teachers' furniture"),
  furniture('PRINCIPAL_FURNITURE', "Principal's furniture"),
  furniture('LAB_FURNITURE', 'Laboratory furniture'),
  furniture('LIBRARY_FURNITURE', 'Library furniture'),
  furniture('WORKSHOP_FURNITURE', 'Workshop furniture'),
  equipment('MAGNETIC_BOARD', 'Magnetic board'),
  equipment('SCIENCE_KIT', 'Science kit'),
  equipment('ICT_EQUIPMENT', 'ICT equipment'),
  equipment('ROBOTICS_EQUIPMENT', 'Robotics equipment'),
  equipment('SPORTS_EQUIPMENT', 'Sports equipment'),
  equipment('PLAY_EQUIPMENT', 'Play equipment'),
  equipment('TAILORING_EQUIPMENT', 'Tailoring equipment'),
  equipment('BAKING_EQUIPMENT', 'Baking equipment'),
  equipment('PHONE_REPAIR_EQUIPMENT', 'Phone repair equipment'),
  equipment('ELECTRICAL_EQUIPMENT', 'Electrical equipment'),
  equipment('COMPUTER', 'Computer'),
  furniture('FILE_CABINET', 'File cabinet'),
  equipment('FRIDGE', 'Fridge'),
  furniture('BOOKSHELF', 'Bookshelf'),
  furniture('BED_AND_BEDDINGS', 'Bed and beddings'),
  furniture('SHOE_AND_BAG', 'Shoe and bag'),
  utility('BOREHOLE', 'Borehole'),
  utility('OVERHEAD_TANK', 'Overhead tank'),
  utility('GENERATOR', 'Generator'),
  { ...utility('SOLAR_POWER', 'Solar power'), pluralName: 'Solar power systems' },
  external('FENCE', 'Fence'),
  { ...external('LANDSCAPING', 'Landscaping'), pluralName: 'Landscaping' },
  { ...external('DRAINAGE', 'Drainage and exterior works'), pluralName: 'Drainage and exterior works' },
  external('FOOTBALL_PITCH', 'Football pitch'),
  external('PLAYGROUND', 'Playground'),
];

export const FacilityDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  /** R3: plural for form placeholders when the simple English plural is wrong; null = derived. */
  pluralName: z.string().nullable(),
  category: z.string().nullable(),
  archetype: FacilityArchetypeEnum,
  isRetired: z.boolean(),
  sortOrder: z.number().int(),
  /** Facility units on any project that use it; a used facility's code is locked. */
  unitCount: z.number().int(),
  /** R3: the sub-form this facility uses (its own when customised, else the archetype default). */
  subForm: z.object({ source: z.enum(['ARCHETYPE', 'FACILITY']), version: z.number().int() }).nullable(),
});
export type FacilityDto = z.infer<typeof FacilityDtoSchema>;

/** The short form embedded in units and pickers. */
export const FacilitySummarySchema = FacilityDtoSchema.pick({ id: true, code: true, name: true, archetype: true, isRetired: true });

const PluralNameSchema = z.string().trim().max(120).nullable().optional().transform((v) => (v === '' ? null : v));
export type FacilitySummary = z.infer<typeof FacilitySummarySchema>;

const FacilityCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FACILITY_CODE_REGEX, 'Code: 2 to 40 capital letters, digits or underscores, e.g. ASSEMBLY_HALL');

export const CreateFacilityRequestSchema = z.object({
  code: FacilityCodeSchema,
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
  pluralName: PluralNameSchema,
  category: z.string().trim().max(80).nullable().optional(),
  archetype: FacilityArchetypeEnum,
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
export type CreateFacilityRequest = z.infer<typeof CreateFacilityRequestSchema>;
export type CreateFacilityRequestInput = z.input<typeof CreateFacilityRequestSchema>;

/** Every field optional; `isRetired` retires or restores. */
export const UpdateFacilityRequestSchema = z.object({
  code: FacilityCodeSchema.optional(),
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(120).optional(),
  pluralName: PluralNameSchema,
  category: z.string().trim().max(80).nullable().optional(),
  archetype: FacilityArchetypeEnum.optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  isRetired: z.boolean().optional(),
});
export type UpdateFacilityRequest = z.infer<typeof UpdateFacilityRequestSchema>;
