import { VehicleSceneAnchor } from './vehicle-scenes.data';
import { PassengerVehicleClassification } from '../services/vehicle-classification';

type Opening = readonly [frontX: number, rearX: number, centerY: number, radius: number];

/** Wheel-opening geometry measured on the unmodified 2400x1350 source canvases. */
const OPENINGS: Readonly<Record<PassengerVehicleClassification, Opening>> = {
  'vehicle-business-sedan': [481, 1786, 1050, 166],
  'vehicle-city-car': [550, 1888, 1020, 182],
  'vehicle-electric-compact': [552, 1907, 940, 184],
  'vehicle-compact-crossover': [572, 1827, 1058, 195],
  'vehicle-compact-sedan': [463, 1812, 1054, 176],
  'vehicle-compact': [539, 1929, 1042, 192],
  'vehicle-coupe-premium-suv': [504, 1852, 1060, 198],
  'vehicle-coupe-suv': [501, 1827, 1044, 170],
  'vehicle-family-sedan': [543, 1801, 1054, 174],
  'vehicle-large-premium-suv': [479, 1819, 1058, 200],
  'vehicle-luxury-sedan': [488, 1824, 1051, 174],
  'vehicle-luxury-suv': [516, 1840, 1064, 196],
  'vehicle-minivan': [518, 1791, 1048, 173],
  'vehicle-premium-van': [454, 1886, 950, 164],
  'vehicle-offroad-luxury': [545, 1791, 1040, 170],
  'vehicle-offroad': [530, 1791, 1074, 196],
  'vehicle-performance-car': [596, 1801, 1040, 162],
  'vehicle-pickup': [522, 1784, 1068, 180],
  'vehicle-popular-crossover': [558, 1815, 1040, 170],
  'vehicle-premium-crossover': [488, 1841, 1061, 190],
  'vehicle-premium-suv': [580, 1876, 1039, 202],
  'vehicle-prius': [564, 1839, 1048, 162],
  'vehicle-range-rover': [482, 1832, 1051, 205],
  'vehicle-small-crossover': [545, 1902, 1038, 180],
  'vehicle-small-cargo-van': [546, 1828, 950, 178],
  'vehicle-sport-coupe': [494, 1830, 1050, 178],
  'vehicle-sport-sedan': [490, 1804, 1047, 172],
  'vehicle-wrangler': [415, 1845, 930, 199],
};

export function getPassengerVehicleAnchors(
  classification: PassengerVehicleClassification,
): readonly VehicleSceneAnchor[] {
  const [frontX, rearX, centerY, radius] = OPENINGS[classification];
  return [
    { id: 'front', axleRole: 'front', cx: frontX, cy: centerY, outerRadius: radius },
    { id: 'rear', axleRole: 'rear', cx: rearX, cy: centerY, outerRadius: radius },
  ];
}
