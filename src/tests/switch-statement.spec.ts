import { runTest } from './util';

const srcSwitchCaseDefault = `
function main(): number {
  let a = 2;
  let r = 0;

  switch (a) {
    case 0:
      r = 0;
      break;
    case 1:
      r = 1;
      break;
    case 2:
      r = 2;
      break;
    default:
      r = 3;
      break;
  }

  return r;
}
`;

const srcSwitchString = `
function main(): number {
  let a = "B";
  let r = 0;

  switch (a) {
    case "A":
      r = 0;
      break;
    case "B":
      r = 1;
      break;
    case "C":
      r = 2;
      break;
    default:
      r = 3;
      break;
  }

  return r;
}
`;

const srcNoDefault = `
function main(): number {
  let a = 2;
  let r = 0;

  switch (a) {
    case 0:
      r = 0;
      break;
    case 1:
      r = 1;
      break;
    case 2:
      r = 2;
      break;
  }

  return r;
}
`;

const srcNoCase = `
function main(): number {
  let a = 2;
  switch (a) {
  }
  return a;
}
`;

const srcSwitchInSwitch = `
function main(): number {
  let a = 1;
  let b = 2;
  let r = 0;

  switch (a) {
    case 0:
      r = 0;
      break
    case 1:
        switch (b) {
          case a:
            r = 10;
          case 2:
            r = 20;
        }
      break;
  }
  return r;
}
`;

runTest('test switch: switch case default', srcSwitchCaseDefault);
runTest('test switch: string', srcSwitchString);
runTest('test switch: no default', srcNoDefault);
runTest('test switch: no case', srcNoCase);
runTest('test switch: switch in switch', srcSwitchInSwitch);
