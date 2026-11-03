import { createInterface } from 'node:readline';

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function flattenLists(values: string[]): string[] {
  return values.flatMap(splitList);
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(`${question} `, (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
}
