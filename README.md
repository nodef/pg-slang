# pg-slang

[![NPM](https://nodei.co/npm/pg-slang.png)](https://nodei.co/npm/pg-slang/)

Convert informal [SQL SELECT] to formal SQL.

```sql
-- ex: SLANG
SELECT "food name", "calcium" FROM "apples"
-- ex: SQL
SELECT "name", "ca", "ca_e" FROM "compositions"
WHERE TRUE AND (FALSE OR ("tsvector" @@ 'apples'))
```

```javascript
const slang = require('pg-slang');
// slang(<informal sql>, <map fn>, [this], [options])
// -> Promise (formal sql)

// <informal sql>:
// SELECT "food name", "trans fat" FROM "food" ORDER BY "trans fat" DESC
// SELECT "protein", "vitamin d" FROM "poultry ORDER BY "vitamin d" DESC
// SELECT "sum: essential amino acids" AS "amino" FROM "meat" ORDER BY "amino"
// ...

// <map fn>(<text>, <type>, [hint], [from]):
// - text: field name, like "food name", "trans fat", "food", ...
// - type: field type, can be "from","columns", "where", "having", "orderBy", or "groupBy"
// - hint: field hint, can be null, "all", "sum", or "avg"
// - from: field from, will be null for type=table
// -> Promise [<value>]
// - value: expression string

// [options]:
// - from: default table
// - limit: default maximum limit
// - limits: table specific maximum limts
```

```javascript
// 1. 
function fnA(text, type, hint, from) {
  return ['sample1', 'sample1'];
};
slang(`SELECT "food name", "calcium" FROM "apples"`, fnA).then(console.log);
// SELECT "sample", "sample" FROM "sample" WHERE TRUE AND TRUE


function fnB(text, type, hint, from) {
  if(type==='column') return ['name'];
  return ['compositions'];
};
slang(`SELECT "food name", "calcium" FROM "apples"`, fnB).then(console.log);
// SELECT "name", "name" FROM "compositions" WHERE TRUE AND TRUE


function fnC(text, type, hint, from) {
  if(type==='column') return ['ca', 'ca_e'];
  return ['compositions'];
};
slang(`SELECT "food name", "calcium" FROM "apples"`, fnC).then(console.log);
// SELECT "ca", "ca_e", "ca", "ca_e" FROM "compositions" WHERE TRUE AND TRUE


var columns = {
  'food code': ['code'],
  'food name': ['name'],
  'calcium': ['ca', 'ca_e'],
  'magnesium': ['mg', 'mg_e']
};
var tables = ['food', 'compositions'];
function fnD(text, type, hint, from) {
  if(type==='column') return columns[text];
  return tables.includes(text)? ['compositions']:[];
};
slang(`SELECT "food name", "calcium" FROM "apples"`, fnD).then(console.log);
// SELECT "name", "ca", "ca_e" FROM "null" WHERE TRUE AND TRUE


function fnE(text, type, hint, from) {
  if(type==='column') return columns[text];
  return tables.includes(text)? ['compositions']:[`"tsvector" @@ '${text}'`];
};
slang(`SELECT "food name", "calcium" FROM "apples"`, fnE).then(console.log);
// SELECT "name", "ca", "ca_e" FROM "null" WHERE TRUE AND (FALSE OR ("tsvector" @@ 'apples'))


var options = {from: 'compositions'};
slang(`SELECT "food name", "calcium" FROM "apples"`, fnE, null, options).then(console.log);
// SELECT "name", "ca", "ca_e" FROM "compositions" WHERE TRUE AND (FALSE OR ("tsvector" @@ 'apples'))


// PRIMARY USECASE
// ---------------
function fnDB(text, type, hint, from) {
  return new Promise((resolve, reject) => {
    // ...
    // <do some database lookup>
    // ...
  });
};
slang(/*  */, fnDB, null, options).then(console.log);
// SELECT "name", "ca", "ca_e" FROM "compositions" WHERE TRUE AND (FALSE OR ("tsvector" @@ 'apples'))


// NOTES
// -----
// 1. Map function return value can be an expression array
// 2. For column, return multiple values to select multiple columns
// 3. But in expressions, only first return value is considered
// 4. Hints perform an operation on matching columns
// 5. Use hint to decide which columns to return
// 6. For table, returning expression will append to where
// 7. Return expression and table name for full association
// 8. Hint can be used in column text as "<hint>: <column text>"
// 9. Hint "all": all|each|every
// 10. Hint "sum": sum|gross|total|whole|aggregate
// 11. Hint "avg": avg|mid|par|mean|norm|center|centre|average|midpoint
// 12. Experiment! And mail me for issues / pull requests!
```


[SQL SELECT]: https://www.postgresql.org/docs/10/static/sql-select.html
