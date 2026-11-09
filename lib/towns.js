/**
 * All 169 Connecticut municipalities, with the town slug used by
 * mytaxbill.org's public bill search.
 *
 * Most towns are published at
 *   https://www.mytaxbill.org/inet/bill/home.do?town=<slug>
 * A handful do not use mytaxbill.org (or currently return an unavailable
 * page), so they are kept in the catalogue but marked unsupported. That way
 * the picker still shows every Connecticut town without pretending a search
 * will work where the upstream site has no records.
 */

const UNAVAILABLE = new Set([
  'avon',
  'darien',
  'eastlyme',
  'ledyard',
  'lyme',
  'milford',
  'salem',
  'southington',
  'winchester',
]);

const TOWN_PAIRS = [
  ['Andover', 'andover'],
  ['Ansonia', 'ansonia'],
  ['Ashford', 'ashford'],
  ['Avon', 'avon'],
  ['Barkhamsted', 'barkhamsted'],
  ['Beacon Falls', 'beaconfalls'],
  ['Berlin', 'berlin'],
  ['Bethany', 'bethany'],
  ['Bethel', 'bethel'],
  ['Bethlehem', 'bethlehem'],
  ['Bloomfield', 'bloomfield'],
  ['Bolton', 'bolton'],
  ['Bozrah', 'bozrah'],
  ['Branford', 'branford'],
  ['Bridgeport', 'bridgeport'],
  ['Bridgewater', 'bridgewater'],
  ['Bristol', 'bristol'],
  ['Brookfield', 'brookfield'],
  ['Brooklyn', 'brooklyn'],
  ['Burlington', 'burlington'],
  ['Canaan', 'canaan'],
  ['Canterbury', 'canterbury'],
  ['Canton', 'canton'],
  ['Chaplin', 'chaplin'],
  ['Cheshire', 'cheshire'],
  ['Chester', 'chester'],
  ['Clinton', 'clinton'],
  ['Colchester', 'colchester'],
  ['Colebrook', 'colebrook'],
  ['Columbia', 'columbia'],
  ['Cornwall', 'cornwall'],
  ['Coventry', 'coventry'],
  ['Cromwell', 'cromwell'],
  ['Danbury', 'danbury'],
  ['Darien', 'darien'],
  ['Deep River', 'deepriver'],
  ['Derby', 'derby'],
  ['Durham', 'durham'],
  ['East Granby', 'eastgranby'],
  ['East Haddam', 'easthaddam'],
  ['East Hampton', 'easthampton'],
  ['East Hartford', 'easthartford'],
  ['East Haven', 'easthaven'],
  ['East Lyme', 'eastlyme'],
  ['East Windsor', 'eastwindsor'],
  ['Eastford', 'eastford'],
  ['Easton', 'easton'],
  ['Ellington', 'ellington'],
  ['Enfield', 'enfield'],
  ['Essex', 'essex'],
  ['Fairfield', 'fairfield'],
  ['Farmington', 'farmington'],
  ['Franklin', 'franklin'],
  ['Glastonbury', 'glastonbury'],
  ['Goshen', 'goshen'],
  ['Granby', 'granby'],
  ['Greenwich', 'greenwich'],
  ['Griswold', 'griswold'],
  ['Groton', 'groton'],
  ['Guilford', 'guilford'],
  ['Haddam', 'haddam'],
  ['Hamden', 'hamden'],
  ['Hampton', 'hampton'],
  ['Middletown', 'middletown'],
  ['Hartland', 'hartland'],
  ['Harwinton', 'harwinton'],
  ['Hebron', 'hebron'],
  ['Kent', 'kent'],
  ['Killingly', 'killingly'],
  ['Killingworth', 'killingworth'],
  ['Lebanon', 'lebanon'],
  ['Ledyard', 'ledyard'],
  ['Lisbon', 'lisbon'],
  ['Litchfield', 'litchfield'],
  ['Lyme', 'lyme'],
  ['Madison', 'madison'],
  ['Manchester', 'manchester'],
  ['Mansfield', 'mansfield'],
  ['Marlborough', 'marlborough'],
  ['Meriden', 'meriden'],
  ['Middlebury', 'middlebury'],
  ['Middlefield', 'middlefield'],
  ['Middletown', 'middletown'],
  ['Milford', 'milford'],
  ['Monroe', 'monroe'],
  ['Montville', 'montville'],
  ['Morris', 'morris'],
  ['Naugatuck', 'naugatuck'],
  ['New Britain', 'newbritain'],
  ['New Canaan', 'newcanaan'],
  ['New Fairfield', 'newfairfield'],
  ['New Hartford', 'newhartford'],
  ['New Haven', 'newhaven'],
  ['New London', 'newlondon'],
  ['New Milford', 'newmilford'],
  ['Newington', 'newington'],
  ['Newtown', 'newtown'],
  ['Norfolk', 'norfolk'],
  ['North Branford', 'northbranford'],
  ['North Canaan', 'northcanaan'],
  ['North Haven', 'northhaven'],
  ['North Stonington', 'northstonington'],
  ['Norwalk', 'norwalk'],
  ['Norwich', 'norwich'],
  ['Old Lyme', 'oldlyme'],
  ['Old Saybrook', 'oldsaybrook'],
  ['Orange', 'orange'],
  ['Oxford', 'oxford'],
  ['Plainfield', 'plainfield'],
  ['Plainville', 'plainville'],
  ['Plymouth', 'plymouth'],
  ['Pomfret', 'pomfret'],
  ['Portland', 'portland'],
  ['Preston', 'preston'],
  ['Prospect', 'prospect'],
  ['Putnam', 'putnam'],
  ['Redding', 'redding'],
  ['Ridgefield', 'ridgefield'],
  ['Rocky Hill', 'rockyhill'],
  ['Roxbury', 'roxbury'],
  ['Salem', 'salem'],
  ['Salisbury', 'salisbury'],
  ['Scotland', 'scotland'],
  ['Seymour', 'seymour'],
  ['Sharon', 'sharon'],
  ['Shelton', 'shelton'],
  ['Sherman', 'sherman'],
  ['Simsbury', 'simsbury'],
  ['Somers', 'somers'],
  ['South Windsor', 'southwindsor'],
  ['Southbury', 'southbury'],
  ['Southington', 'southington'],
  ['Sprague', 'sprague'],
  ['Stafford', 'stafford'],
  ['Stamford', 'stamford'],
  ['Sterling', 'sterling'],
  ['Stonington', 'stonington'],
  ['Stratford', 'stratford'],
  ['Suffield', 'suffield'],
  ['Thomaston', 'thomaston'],
  ['Thompson', 'thompson'],
  ['Tolland', 'tolland'],
  ['Torrington', 'torrington'],
  ['Trumbull', 'trumbull'],
  ['Union', 'union'],
  ['Vernon', 'vernon'],
  ['Voluntown', 'voluntown'],
  ['Wallingford', 'wallingford'],
  ['Warren', 'warren'],
  ['Washington', 'washington'],
  ['Waterbury', 'waterbury'],
  ['Waterford', 'waterford'],
  ['Watertown', 'watertown'],
  ['West Hartford', 'westhartford'],
  ['West Haven', 'westhaven'],
  ['Westbrook', 'westbrook'],
  ['Weston', 'weston'],
  ['Westport', 'westport'],
  ['Wethersfield', 'wethersfield'],
  ['Willington', 'willington'],
  ['Wilton', 'wilton'],
  ['Winchester', 'winchester'],
  ['Windham', 'windham'],
  ['Windsor', 'windsor'],
  ['Windsor Locks', 'windsorlocks'],
  ['Wolcott', 'wolcott'],
  ['Woodbridge', 'woodbridge'],
  ['Woodbury', 'woodbury'],
  ['Woodstock', 'woodstock'],
];

export const TOWNS = Object.freeze(
  TOWN_PAIRS.map(([name, slug]) =>
    Object.freeze({
      name,
      slug,
      supported: !UNAVAILABLE.has(slug),
      url: `https://www.mytaxbill.org/inet/bill/home.do?town=${slug}`,
    }),
  ),
);

export const TOWN_BY_SLUG = new Map(TOWNS.map((town) => [town.slug, town]));
export const DEFAULT_TOWN = 'hartford';
export const SUPPORTED_TOWNS = TOWNS.filter((town) => town.supported);

export function normalizeTownSlug(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function resolveTown(value) {
  const slug = normalizeTownSlug(value);
  return slug ? TOWN_BY_SLUG.get(slug) || null : null;
}

export function townName(town) {
  return resolveTown(town)?.name || String(town ?? '');
}

export function townSourceUrl(town) {
  const resolved = resolveTown(town);
  return resolved
    ? resolved.url
    : 'https://www.mytaxbill.org/inet/bill/home.do?town=hartford';
}
