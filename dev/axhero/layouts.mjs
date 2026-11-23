// prints the cockpit's feature list (GROUPS: id, icon, name, description in VI / EN / KO) as JSON, for the intro page
import fs from 'fs'
const s = fs.readFileSync(new URL('../../Greenbox-Cockpit.html', import.meta.url), 'utf8')
const i = s.indexOf('const GROUPS=['), j = s.indexOf('const ALL=GROUPS', i)
const src = s.slice(i, j).replace('const GROUPS=', 'return ')
const GROUPS = new Function('T3', src)((vi, en, ko) => ({ vi, en, ko }))
console.log(JSON.stringify(GROUPS.filter(g => !g.hold).map(g => ({ id: g.id, name: g.name, items: g.items.map(f => ({ id: f.id, ic: f.ic, name: f.name, d: f.d })) }))))
