const Parser = require('flora-sql-parser').Parser;
const astToSQL = require('flora-sql-parser').util.astToSQL;

const NULL = /^null$/i;
const BOOL = /^(true|false)$/i;
const NUMBER = /^[\d\.\-e]$/i;
const STRING = /^\'[^\']\'$/;
const IDENTIFIER = /^\w+$|^\"[^\"]*\"$/;
const HINT_ALL = /^(all|each|every):/i;
const HINT_SUM = /^(sum|gross|total|whole|aggregate):/i;
const HINT_AVG = /^(avg|mid|par|mean|norm|center|centre|average|midpoint):/i;
const FROMT = [{table: 't', as: null}];

function number(value) {
  return {type: 'number', value};
};
function column(column) {
  return {type: 'column_ref', table: null, column};
};
function table(table, as=null) {
  return {db: null, table, as};
};
function binaryExpr(operator, left, right, parentheses=false) {
  return {type: 'binary_expr', operator, left, right, parentheses};
};

function dequote(txt) {
  return /^[\'\"]/.test(txt)? txt.slice(1, -1):txt;
};

function clean(txt) {
  txt = txt.replace(/\/\*.*?\*\//gm, '');
  txt = txt.replace(/\-\-.*/g, '').trim();
  return txt.endsWith(';')? txt.slice(0, -1):txt;
};

function setLimit(ast, max) {
  var value = Math.min(ast.limit? ast.limit[1].value:max, max);
  ast.limit = [{type: 'number', value}];
};

function getSum(cols) {
  if(cols.length===0) return [number(0)];
  if(cols.length===1) return [cols[0]];
  var asw = binaryExpr('+', cols[0], cols[1], true);
  for(var i=2, I=cols.length; i<I; i++)
    asw.right = binaryExpr('+', asw.right, cols[i]);
  return [asw];
};

function getAvg(cols) {
  if(cols.length===0) return [number(0)];
  var asw = binaryExpr('/', getSum(cols)[0], number(cols.length), true);
  return [asw];
};

function parseExpression(exp) {
  exp = exp.replace(/<>/g, '!=').replace(/@@/g, '<>');
  var txt = `SELECT * FROM T WHERE (${exp})`;
  var asw = new Parser().parse(txt);
  return asw.where;
};

function parseValue(val) {
  if(NULL.test(val)) return {type: 'null', value: null};
  if(BOOL.test(val)) return {type: 'bool', value: /true/i.test(val)};
  if(NUMBER.test(val)) return {type: 'number', value: parseFloat(val)};
  if(STRING.test(val)) return {type: 'string', value: val.slice(1, -1)};
  if(IDENTIFIER.test(val)) return column(dequote(val));
  return parseExpression(val);
};

async function getColumn(from, txt, fn, ths=null) {
  var type = 'column', hint = null;
  if(HINT_ALL.test(txt)) hint = 'all';
  else if(HINT_SUM.test(txt)) hint = 'sum';
  else if(HINT_AVG.test(txt)) hint = 'avg';
  var ans = await fn.call(ths, hint? txt.replace(/.*?:/, ''):txt, type, hint, from);
  ans = (ans||[]).map(val => parseValue(val));
  if(hint==null || hint==='all') return ans;
  return hint==='sum'? getSum(ans):getAvg(ans);
};

function setSubexpression(from, ast, k, fn, ths=null) {
  if(ast[k]==null || typeof ast[k]!=='object') return Promise.resolve();
  if(ast[k].type==='column_ref') return getColumn(from, ast[k].column, fn, ths).then(ans => ast[k]=ans[0]);
  return Promise.all(Object.keys(ast[k]).map(l => setSubexpression(from, ast[k], l, fn, ths)));
};

function getExpression(from, ast, fn, ths=null) {
  if(ast.type==='column_ref') return getColumn(from, ast.column, fn, ths);
  return Promise.all(Object.keys(ast).map(k => setSubexpression(from, ast, k, fn, ths))).then(() => [ast]);
};

function asExpression(expr) {
  var sql = astToSQL({type: 'select', from: FROMT, columns: [{expr, as: null}]});
  return sql.substring(7, sql.length-9).replace(/([\'\"])/g, '$1$1');
};

function asColumn(col, len, as) {
  return txt = len>1 && as!=null? as+': '+col:as;
};

async function tweakColumns(from, ast, fn, ths=null) {
  var columns = ast.columns, to = [];
  var ans = await Promise.all(columns.map(col => getExpression(from, col.expr, fn, ths)));
  for(var i=0, I=columns.length; i<I; i++) {
    var col = columns[i], exps = ans[i];
    for(var exp of exps) {
      if(exp.type!=='column_ref') to.push({expr: exp, as: col.as==null? asExpression(exp):col.as});
      else to.push({expr: exp, as: asColumn(exp.column, exps.length, col.as)});
    }
  }
  ast.columns = to;
};

function tweakWhere(from, ast, fn, ths=null) {
  setSubexpression(from, ast, 'where', fn, ths);
};

function tweakHaving(from, ast, fn, ths=null) {
  setSubexpression(from, ast, 'having', fn, ths);
};

async function tweakOrderBy(from, ast, fn, ths=null) {
  var orderby = ast.orderby, to = [];
  var ans = await Promise.all(orderby.map(col => getExpression(from, col.expr, fn, ths)));
  for(var i=0, I=orderby.length; i<I; i++) {
    var col = orderby[i], exps = ans[i];
    for(var exp of exps)
      to.push({expr: exp, type: col.type});
  }
  ast.orderby = to;
};

async function tweakGroupBy(from, ast, fn, ths=null) {
  var groupby = ast.groupby, to = [];
  var ans = await Promise.all(groupby.map(exp => getExpression(from, exp, fn, ths)));
  for(var val of ans)
    to.push.apply(to, val);
  ast.groupby = to
};

function forkWhere(ast) {
  var txt = `SELECT * FROM T WHERE TRUE AND TRUE`;
  var asw = new Parser().parse(txt);
  if(ast.where) {
    asw.where.left = ast.where;
    ast.where = asw.where;
    ast.where.left.parentheses = true;
  }
  else ast.where = asw.where;
  return ast;
};

function appendWhere(ast, exp) {
  exp = exp.replace(/<>/g, '!=').replace(/@@/g, '<>');
  var txt = `SELECT * FROM T WHERE FALSE OR (${exp})`;
  var asw = new Parser().parse(txt);
  var opr = asw.where.right.operator.replace(/<>/, '@@');
  asw.where.right.operator = opr;
  if(ast.where.right.value===true) {
    ast.where.right = asw.where;
    ast.where.right.parentheses = true;
  }
  else {
    asw.where.left = ast.where.right.right;
    ast.where.right.right = asw.where;
  }
  return ast;
};

async function scanFrom(ast, fn, ths=null) {
  var from = ast.from, to = new Set(), where = [];
  var ans = await Promise.all(from.map(b => fn.call(ths, b.table, 'table', null, null)||[]));
  for(var vals of ans) {
    for(var val of vals) {
      if(IDENTIFIER.test(val)) to.add(dequote(val));
      else where.push(val);
    }
  }
  return {from: Array.from(to), where};
};

function tweakFrom(ast, scn) {
  var ast = forkWhere(ast);
  for(var val of scn.where)
    appendWhere(ast, val);
  ast.from = scn.from.map(v => table(v));
};

function slang(txt, fn, ths=null, opt={}) {
  var ast = new Parser().parse(clean(txt)), rdy = [];
  if(ast.type!=='select') return Promise.reject(new Error(`Only SELECT supported <<${txt}>>.`));
  return scanFrom(ast, fn, ths).then(scn => {
    var from = scn.from;
    if(from.length===0 && opt.from!=null) from.push(opt.from);
    if(typeof ast.columns!=='string') rdy.push(tweakColumns(from, ast, fn, ths));
    if(ast.where!=null) rdy.push(tweakWhere(from, ast, fn, ths));
    if(ast.having!=null) rdy.push(tweakHaving(from, ast, fn, ths));
    if(ast.orderby!=null) rdy.push(tweakOrderBy(from, ast, fn, ths));
    if(ast.groupby!=null) rdy.push(tweakGroupBy(from, ast, fn, ths));
    return Promise.all(rdy).then(() => scn);
  }).then(scn => {
    tweakFrom(ast, scn);
    if(ast.from.length===0) ast.from.push(table('null'));
    var lim = opt.limits? opt.limits[ast.from[0].table]||0:opt.limit||0;
    if(lim) setLimit(ast, lim);
    return astToSQL(ast);
  });
};
module.exports = slang;
