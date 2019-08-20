import Debug from 'debug';
import llvm from 'llvm-node';
import ts from 'typescript';

import Symtab from '../symtab';
import CodeGenArray from './array-literal-expression';
import CodeGenForOf from './for-of-statement';
import CodeGenFor from './for-statement';
import CodeGenFuncDecl from './function-declaration';
import CodeGenIf from './if-statement';
import CodeGenReturn from './return-statement';
import CodeGenVarDecl from './variable-declaration';

const debug = Debug('minits:codegen');

debug('codegen');

export default class LLVMCodeGen {
  public readonly builder: llvm.IRBuilder;
  public readonly context: llvm.LLVMContext;
  public readonly module: llvm.Module;
  public readonly symtab: Symtab;

  public readonly cgArray: CodeGenArray;
  public readonly cgForOf: CodeGenForOf;
  public readonly cgFor: CodeGenFor;
  public readonly cgFuncDecl: CodeGenFuncDecl;
  public readonly cgIf: CodeGenIf;
  public readonly cgReturn: CodeGenReturn;
  public readonly cgVarDecl: CodeGenVarDecl;

  public currentFunction: llvm.Function | undefined;
  public currentType: ts.TypeNode | undefined;

  constructor() {
    this.context = new llvm.LLVMContext();
    this.module = new llvm.Module('main', this.context);
    this.builder = new llvm.IRBuilder(this.context);
    this.symtab = new Symtab();

    this.cgArray = new CodeGenArray(this);
    this.cgForOf = new CodeGenForOf(this);
    this.cgFor = new CodeGenFor(this);
    this.cgFuncDecl = new CodeGenFuncDecl(this);
    this.cgIf = new CodeGenIf(this);
    this.cgReturn = new CodeGenReturn(this);
    this.cgVarDecl = new CodeGenVarDecl(this);

    this.currentFunction = undefined;
    this.currentType = undefined;
  }

  public genText(): string {
    return this.module.print();
  }

  public genSourceFile(sourceFile: ts.SourceFile): void {
    sourceFile.forEachChild(node => {
      switch (node.kind) {
        case ts.SyntaxKind.EndOfFileToken:
          return;
        case ts.SyntaxKind.VariableStatement:
          this.genVariableStatement(node as ts.VariableStatement);
          break;
        case ts.SyntaxKind.FunctionDeclaration:
          this.genFunctionDeclaration(node as ts.FunctionDeclaration);
          break;
        default:
          throw new Error('Unsupported grammar');
      }
    });
  }

  public genNumeric(node: ts.NumericLiteral): llvm.ConstantInt {
    const text = node.getText();
    const bits = (() => {
      if (text.startsWith('0x')) {
        return 16;
      } else {
        return 10;
      }
    })();
    return llvm.ConstantInt.get(this.context, parseInt(text, bits), 64);
  }

  public genBoolean(node: ts.BooleanLiteral): llvm.ConstantInt {
    switch (node.kind) {
      case ts.SyntaxKind.FalseKeyword:
        return llvm.ConstantInt.get(this.context, 0, 1);
      case ts.SyntaxKind.TrueKeyword:
        return llvm.ConstantInt.get(this.context, 1, 1);
      default:
        throw new Error('Unsupported boolean value');
    }
  }

  public genIdentifier(node: ts.Identifier): llvm.Value {
    return this.symtab.get(node.getText());
  }

  public genAutoDereference(node: llvm.Value): llvm.Value {
    if (node.type.isPointerTy()) {
      return this.builder.createLoad(node);
    }
    return node;
  }

  public genType(type: ts.TypeNode): llvm.Type {
    switch (type.kind) {
      case ts.SyntaxKind.BooleanKeyword:
        return llvm.Type.getInt1Ty(this.context);
      case ts.SyntaxKind.NumberKeyword:
        return llvm.Type.getInt64Ty(this.context);
      default:
        throw new Error('Unsupported type');
    }
  }

  public genBlock(node: ts.Block): void {
    node.statements.forEach(b => {
      this.genStatement(b);
    });
  }

  public genExpression(expr: ts.Expression): llvm.Value {
    switch (expr.kind) {
      case ts.SyntaxKind.NumericLiteral:
        return this.genNumeric(expr as ts.NumericLiteral);
      case ts.SyntaxKind.Identifier:
        return this.genIdentifier(expr as ts.Identifier);
      case ts.SyntaxKind.FalseKeyword:
        return this.genBoolean(expr as ts.BooleanLiteral);
      case ts.SyntaxKind.TrueKeyword:
        return this.genBoolean(expr as ts.BooleanLiteral);
      case ts.SyntaxKind.ArrayLiteralExpression:
        return this.genArrayLiteral(expr as ts.ArrayLiteralExpression);
      case ts.SyntaxKind.ElementAccessExpression:
        return this.genElementAccess(expr as ts.ElementAccessExpression);
      case ts.SyntaxKind.CallExpression:
        return this.genCallExpression(expr as ts.CallExpression);
      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.genPrefixUnaryExpression(expr as ts.PrefixUnaryExpression);
      case ts.SyntaxKind.PostfixUnaryExpression:
        return this.genPostfixUnaryExpression(
          expr as ts.PostfixUnaryExpression
        );
      case ts.SyntaxKind.BinaryExpression:
        return this.genBinaryExpression(expr as ts.BinaryExpression);
      default:
        throw new Error('Unsupported expression');
    }
  }

  public genArrayLiteral(node: ts.ArrayLiteralExpression): llvm.AllocaInst {
    return this.cgArray.genArrayLiteral(node);
  }

  public genElementAccess(node: ts.ElementAccessExpression): llvm.Value {
    return this.cgArray.genArrayElementAccess(node);
  }

  public genCallExpression(expr: ts.CallExpression): llvm.Value {
    const name = expr.expression.getText();
    const args = expr.arguments.map(item => {
      return this.genExpression(item);
    });
    const func = this.module.getFunction(name)!;
    return this.builder.createCall(func, args);
  }

  public genPrefixUnaryExpression(expr: ts.PrefixUnaryExpression): llvm.Value {
    switch (expr.operator) {
      case ts.SyntaxKind.TildeToken:
        return this.builder.createXor(
          this.genAutoDereference(this.genExpression(expr.operand)),
          llvm.ConstantInt.get(this.context, -1, 64)
        );
      default:
        throw new Error('Unsupported prefix unary expression');
    }
  }

  public genPostfixUnaryExpression(
    expr: ts.PostfixUnaryExpression
  ): llvm.Value {
    const e = expr.operand as ts.Expression;
    const lhs = this.genExpression(e);
    switch (expr.operator) {
      case ts.SyntaxKind.PlusPlusToken:
        return this.genPostfixUnaryExpressionPlusPlus(lhs, e.getText());
      case ts.SyntaxKind.MinusMinusToken:
        return this.genPostfixUnaryExpressionMinusMinus(lhs, e.getText());
    }
    return lhs;
  }

  public genPostfixUnaryExpressionPlusPlus(
    node: llvm.Value,
    name: string
  ): llvm.Value {
    const raw = this.builder.createLoad(node);
    const one = llvm.ConstantInt.get(this.context, 1, 64);
    const r = this.builder.createAdd(raw, one);
    const ptr = this.symtab.get(name);
    this.builder.createStore(r, ptr);
    return raw;
  }

  public genPostfixUnaryExpressionMinusMinus(
    node: llvm.Value,
    name: string
  ): llvm.Value {
    const raw = this.builder.createLoad(node);
    const one = llvm.ConstantInt.get(this.context, 1, 64);
    const r = this.builder.createSub(raw, one);
    const ptr = this.symtab.get(name);
    this.builder.createStore(r, ptr);
    return raw;
  }

  public genBinaryExpression(expr: ts.BinaryExpression): llvm.Value {
    const lhs = (() => {
      const val = this.genExpression(expr.left);
      if (AssignmentOperator.includes(expr.operatorToken.kind)) {
        return val;
      }
      return this.genAutoDereference(val);
    })();
    const rhs = this.genAutoDereference(this.genExpression(expr.right));

    switch (expr.operatorToken.kind) {
      case ts.SyntaxKind.LessThanToken: // <
        return this.builder.createICmpSLT(lhs, rhs);
      case ts.SyntaxKind.GreaterThanToken: // >
        return this.builder.createICmpSGT(lhs, rhs);
      case ts.SyntaxKind.LessThanEqualsToken: // <=
        return this.builder.createICmpSLE(lhs, rhs);
      case ts.SyntaxKind.GreaterThanEqualsToken: // >=
        return this.builder.createICmpSGE(lhs, rhs);
      case ts.SyntaxKind.EqualsEqualsToken: // ==
        return this.builder.createICmpEQ(lhs, rhs);
      case ts.SyntaxKind.ExclamationEqualsToken: // !=
        return this.builder.createICmpNE(lhs, rhs);
      case ts.SyntaxKind.EqualsEqualsEqualsToken: // ===
        return this.builder.createICmpEQ(lhs, rhs);
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: // !==
        return this.builder.createICmpNE(lhs, rhs);
      case ts.SyntaxKind.PlusToken: // +
        return this.builder.createAdd(lhs, rhs);
      case ts.SyntaxKind.PlusEqualsToken: // +=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createAdd(l, r)
        );
      case ts.SyntaxKind.MinusToken: // -
        return this.builder.createSub(lhs, rhs);
      case ts.SyntaxKind.MinusEqualsToken: // -=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createSub(l, r)
        );
      case ts.SyntaxKind.AsteriskToken: // *
        return this.builder.createMul(lhs, rhs);
      case ts.SyntaxKind.AsteriskEqualsToken: // *=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createMul(l, r)
        );
      case ts.SyntaxKind.SlashToken: // /
        return this.builder.createSDiv(lhs, rhs);
      case ts.SyntaxKind.SlashEqualsToken: // /=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createSDiv(l, r)
        );
      case ts.SyntaxKind.PercentToken: // %
        return this.builder.createSRem(lhs, rhs);
      case ts.SyntaxKind.PercentEqualsToken:
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createSRem(l, r)
        );
      case ts.SyntaxKind.LessThanLessThanToken: // <<
        return this.builder.createShl(lhs, rhs);
      case ts.SyntaxKind.LessThanLessThanEqualsToken: // <<=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createShl(l, r)
        );
      case ts.SyntaxKind.AmpersandToken: // &
        return this.builder.createAnd(lhs, rhs);
      case ts.SyntaxKind.AmpersandEqualsToken: // &=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createAnd(l, r)
        );
      case ts.SyntaxKind.BarToken: // |
        return this.builder.createOr(lhs, rhs);
      case ts.SyntaxKind.BarEqualsToken: // |=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createOr(l, r)
        );
      case ts.SyntaxKind.CaretToken: // ^
        return this.builder.createXor(lhs, rhs);
      case ts.SyntaxKind.CaretEqualsToken: // ^=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createXor(l, r)
        );
      case ts.SyntaxKind.AmpersandAmpersandToken: // &&
        const aaInitBlock = this.builder.getInsertBlock()!;
        const aaNextBlock = llvm.BasicBlock.create(
          this.context,
          'next',
          this.currentFunction
        );
        const aaQuitBlock = llvm.BasicBlock.create(
          this.context,
          'quit',
          this.currentFunction
        );
        this.builder.createCondBr(lhs, aaNextBlock, aaQuitBlock);
        this.builder.setInsertionPoint(aaNextBlock);
        this.builder.createBr(aaQuitBlock);
        this.builder.setInsertionPoint(aaQuitBlock);
        const aaPhi = this.builder.createPhi(
          llvm.Type.getInt1Ty(this.context),
          2
        );
        aaPhi.addIncoming(
          llvm.ConstantInt.get(this.context, 0, 1),
          aaInitBlock
        );
        aaPhi.addIncoming(rhs, aaNextBlock);
        return aaPhi;
      case ts.SyntaxKind.BarBarToken: // ||
        const bbInitBlock = this.builder.getInsertBlock()!;
        const bbNextBlock = llvm.BasicBlock.create(
          this.context,
          'next',
          this.currentFunction
        );
        const bbQuitBlock = llvm.BasicBlock.create(
          this.context,
          'quit',
          this.currentFunction
        );
        this.builder.createCondBr(lhs, bbQuitBlock, bbNextBlock);
        this.builder.setInsertionPoint(bbNextBlock);
        this.builder.createBr(bbQuitBlock);
        this.builder.setInsertionPoint(bbQuitBlock);
        const bbPhi = this.builder.createPhi(
          llvm.Type.getInt1Ty(this.context),
          2
        );
        bbPhi.addIncoming(
          llvm.ConstantInt.get(this.context, 1, 1),
          bbInitBlock
        );
        bbPhi.addIncoming(rhs, bbNextBlock);
        return bbPhi;
      case ts.SyntaxKind.EqualsToken: // =
        return this.builder.createStore(rhs, lhs);
      case ts.SyntaxKind.GreaterThanGreaterThanToken: // >>
        return this.builder.createAShr(lhs, rhs);
      case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken: // >>=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createAShr(l, r)
        );
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: // >>>
        return this.builder.createLShr(lhs, rhs);
      case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken: // >>>=
        return this.genCompoundAssignment(lhs, rhs, (l, r) =>
          this.builder.createLShr(l, r)
        );
      default:
        throw new Error('Unsupported binaryexpression');
    }
  }

  public genCompoundAssignment(
    lhs: llvm.Value,
    rhs: llvm.Value,
    cb: (lhs: llvm.Value, rhs: llvm.Value) => llvm.Value
  ): llvm.Value {
    const realLHS = this.builder.createLoad(lhs);
    const realRHS = rhs.type.isPointerTy() ? this.builder.createLoad(rhs) : rhs;

    const result = cb(realLHS, realRHS);
    this.builder.createStore(result, lhs);
    return lhs;
  }

  public genStatement(node: ts.Statement): llvm.Value | void {
    switch (node.kind) {
      case ts.SyntaxKind.Block:
        return this.genBlock(node as ts.Block);
      case ts.SyntaxKind.VariableStatement:
        return this.genVariableStatement(node as ts.VariableStatement);
      case ts.SyntaxKind.ExpressionStatement:
        return this.genExpressionStatement(node as ts.ExpressionStatement);
      case ts.SyntaxKind.IfStatement:
        return this.genIfStatement(node as ts.IfStatement);
      case ts.SyntaxKind.ForStatement:
        return this.genForStatement(node as ts.ForStatement);
      case ts.SyntaxKind.ForOfStatement:
        return this.genForOfStatement(node as ts.ForOfStatement);
      case ts.SyntaxKind.ReturnStatement:
        return this.genReturnStatement(node as ts.ReturnStatement);
      default:
        throw new Error('Unsupported statement');
    }
  }

  public genVariableDeclaration(node: ts.VariableDeclaration): llvm.Value {
    return this.cgVarDecl.genVariableDeclaration(node);
  }

  public genVariableStatement(node: ts.VariableStatement): void {
    node.declarationList.declarations.forEach(item => {
      this.genVariableDeclaration(item);
    });
  }

  public genExpressionStatement(node: ts.ExpressionStatement): llvm.Value {
    return this.genExpression(node.expression);
  }

  public genReturnStatement(node: ts.ReturnStatement): llvm.Value {
    return this.cgReturn.genReturnStatement(node);
  }

  public genFunctionDeclaration(node: ts.FunctionDeclaration): llvm.Function {
    return this.cgFuncDecl.genFunctionDeclaration(node);
  }

  public genIfStatement(node: ts.IfStatement): void {
    return this.cgIf.genIfStatement(node);
  }

  public genForStatement(node: ts.ForStatement): void {
    return this.cgFor.genForStatement(node);
  }

  public genForOfStatement(node: ts.ForOfStatement): void {
    return this.cgForOf.genForOfStatement(node);
  }
}

const CompoundAssignmentOperator = [
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken
];
const AssignmentOperator = [ts.SyntaxKind.EqualsToken].concat(
  CompoundAssignmentOperator
);