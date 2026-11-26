import type { TagGroup } from '../types';

/**
 * Realistic IT-student clipboard snippets with the expected classification.
 * `tags` = tags that MUST be present; `notTags` = tags that must NOT be present.
 * `lang` is checked only when given. `secret` defaults to false.
 *
 * All credentials below are fabricated / documentation examples.
 */
export interface Fixture {
  name: string;
  text: string;
  tags?: string[];
  notTags?: string[];
  lang?: string;
  group: TagGroup;
  secret?: boolean;
}

const FENCE = '```';

export const FIXTURES: Fixture[] = [
  // ───────────────────────── Code ─────────────────────────
  {
    name: 'python function',
    text: 'def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n',
    tags: ['code', 'python'],
    lang: 'python',
    group: 'code',
  },
  {
    name: 'python class + import',
    text: 'import os\nfrom dataclasses import dataclass\n\nclass Student:\n    def __init__(self, name):\n        self.name = name\n',
    tags: ['code', 'python'],
    lang: 'python',
    group: 'code',
  },
  {
    name: 'python main guard',
    text: 'if __name__ == "__main__":\n    main()',
    tags: ['code', 'python'],
    lang: 'python',
    group: 'code',
  },
  {
    name: 'python numpy/pandas script',
    text: 'import numpy as np\nimport pandas as pd\ndf = pd.read_csv("a.csv")',
    tags: ['code', 'python'],
    lang: 'python',
    group: 'code',
  },
  {
    name: 'python print one-liner',
    text: 'print("hello world")',
    tags: ['code', 'python'],
    lang: 'python',
    group: 'code',
  },
  {
    name: 'javascript arrow + console',
    text: 'const nums = [1, 2, 3];\nconst doubled = nums.map((n) => n * 2);\nconsole.log(doubled);',
    tags: ['code', 'javascript'],
    lang: 'javascript',
    group: 'code',
  },
  {
    name: 'javascript node require',
    text: "const fs = require('fs');\nfs.readFile('a.txt', 'utf8', function (err, data) {\n  if (err) throw err;\n  console.log(data);\n});",
    tags: ['code', 'javascript'],
    lang: 'javascript',
    group: 'code',
  },
  {
    name: 'typescript interface',
    text: 'interface User {\n  id: number;\n  name: string;\n  email?: string;\n}\n\nexport function greet(u: User): string {\n  return `Hi ${u.name}`;\n}',
    tags: ['code', 'typescript'],
    lang: 'typescript',
    group: 'code',
  },
  {
    name: 'typescript type alias',
    text: "type Status = 'idle' | 'loading' | 'error';\nimport type { Item } from './types';",
    tags: ['code', 'typescript'],
    lang: 'typescript',
    group: 'code',
  },
  {
    name: 'java hello world',
    text: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
    tags: ['code', 'java'],
    lang: 'java',
    group: 'code',
  },
  {
    name: 'c hello world',
    text: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello\\n");\n    return 0;\n}',
    tags: ['code', 'c'],
    lang: 'c',
    group: 'code',
  },
  {
    name: 'cpp iostream',
    text: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hi" << endl;\n    return 0;\n}',
    tags: ['code', 'cpp'],
    lang: 'cpp',
    group: 'code',
  },
  {
    name: 'cpp vector std::',
    text: 'std::vector<int> v = {1, 2, 3};\nfor (auto x : v) std::cout << x << std::endl;',
    tags: ['code', 'cpp'],
    lang: 'cpp',
    group: 'code',
  },
  {
    name: 'csharp console app',
    text: 'using System;\n\nnamespace Demo\n{\n    class Program\n    {\n        static void Main(string[] args)\n        {\n            Console.WriteLine("Hi");\n        }\n    }\n}',
    tags: ['code', 'csharp'],
    lang: 'csharp',
    group: 'code',
  },
  {
    name: 'sql select join',
    text: 'SELECT s.name, c.title\nFROM students s\nJOIN courses c ON c.id = s.course_id\nWHERE s.year = 2\nORDER BY s.name;',
    tags: ['code', 'sql'],
    lang: 'sql',
    group: 'code',
  },
  {
    name: 'sql create table',
    text: 'CREATE TABLE users (\n  id INT PRIMARY KEY,\n  name VARCHAR(50) NOT NULL\n);',
    tags: ['code', 'sql'],
    lang: 'sql',
    group: 'code',
  },
  {
    name: 'sql lowercase insert',
    text: "insert into users (id, name) values (1, 'ana');",
    tags: ['sql'],
    lang: 'sql',
    group: 'code',
  },
  {
    name: 'html snippet',
    text: '<div class="card">\n  <h2>Title</h2>\n  <p>Body</p>\n</div>',
    tags: ['code', 'html'],
    lang: 'html',
    group: 'code',
  },
  {
    name: 'html doctype',
    text: '<!DOCTYPE html>\n<html lang="en">\n<head><title>Hi</title></head>\n<body></body>\n</html>',
    tags: ['code', 'html'],
    lang: 'html',
    group: 'code',
  },
  {
    name: 'css rule',
    text: '.card {\n  color: #333;\n  display: flex;\n  margin: 0 auto;\n}',
    tags: ['code', 'css'],
    lang: 'css',
    group: 'code',
  },
  {
    name: 'css media query',
    text: '@media (max-width: 600px) {\n  body { font-size: 14px; }\n}',
    tags: ['code', 'css'],
    lang: 'css',
    group: 'code',
  },
  {
    name: 'bash script with shebang',
    text: '#!/bin/bash\nfor f in *.txt; do\n  echo "Processing $f"\ndone\nif [ -z "$1" ]; then\n  exit 1\nfi',
    tags: ['code', 'bash'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'powershell script',
    text: '$files = Get-ChildItem -Path $env:USERPROFILE -Recurse\n$files | Where-Object { $_.Length -gt 1MB } | Select-Object Name',
    tags: ['code', 'powershell'],
    lang: 'powershell',
    group: 'code',
  },
  {
    name: 'go program',
    text: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tx := 5\n\tfmt.Println(x)\n}',
    tags: ['code', 'go'],
    lang: 'go',
    group: 'code',
  },
  {
    name: 'rust program',
    text: 'fn main() {\n    let mut v = Vec::new();\n    v.push(1);\n    println!("{:?}", v);\n}',
    tags: ['code', 'rust'],
    lang: 'rust',
    group: 'code',
  },
  {
    name: 'php page',
    text: '<?php\n$name = $_GET["name"];\necho "Hello " . $name;\n?>',
    tags: ['code', 'php'],
    lang: 'php',
    group: 'code',
  },
  {
    name: 'json object',
    text: '{\n  "name": "stash",\n  "version": "1.0.0",\n  "tags": ["a", "b"]\n}',
    tags: ['json'],
    lang: 'json',
    group: 'code',
  },
  {
    name: 'json array',
    text: '[{"id":1,"ok":true},{"id":2,"ok":false}]',
    tags: ['json'],
    lang: 'json',
    group: 'code',
  },
  {
    name: 'yaml docker compose',
    text: 'version: "3.8"\nservices:\n  web:\n    image: nginx\n    ports:\n      - "8080:80"\n',
    tags: ['yaml'],
    lang: 'yaml',
    group: 'code',
  },
  {
    name: 'yaml kubernetes',
    text: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: demo\nspec:\n  containers:\n    - name: app\n      image: busybox',
    tags: ['yaml'],
    lang: 'yaml',
    group: 'code',
  },

  // ───────────────────────── Commands ─────────────────────────
  {
    name: 'git clone',
    text: 'git clone https://github.com/octocat/Hello-World.git',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'npm install',
    text: 'npm install --save-dev vitest',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'pip install multiple packages',
    text: 'pip install requests flask numpy',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'docker run',
    text: 'docker run -d -p 8080:80 --name web nginx:latest',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'kubectl',
    text: 'kubectl get pods -n kube-system',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'ssh with ip',
    text: 'ssh admin@192.168.1.10',
    tags: ['command', 'ip'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'multi-line shell session',
    text: '$ cd ~/projects\n$ ls -la\n$ sudo apt update && sudo apt upgrade -y',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'curl post',
    text: 'curl -X POST https://api.example.com/v1/items -H "Content-Type: application/json" -d \'{"a":1}\'',
    tags: ['command'],
    lang: 'bash',
    group: 'code',
  },
  {
    name: 'ping',
    text: 'ping -c 4 8.8.8.8',
    tags: ['command', 'ip'],
    group: 'code',
  },
  {
    name: 'ipconfig',
    text: 'ipconfig /all',
    tags: ['command'],
    lang: 'powershell',
    group: 'code',
  },
  {
    name: 'nmap scan',
    text: 'nmap -sV -p 1-1000 10.0.0.5',
    tags: ['command', 'ip'],
    group: 'code',
  },
  {
    name: 'netstat',
    text: 'netstat -tulpn | grep LISTEN',
    tags: ['command'],
    group: 'code',
  },
  {
    name: 'powershell prompt',
    text: 'PS C:\\Users\\me> Get-Process | Sort-Object CPU -Descending',
    tags: ['command'],
    lang: 'powershell',
    group: 'code',
  },

  // ───────────────────────── Network ─────────────────────────
  {
    name: 'ipv4 address',
    text: '192.168.1.254',
    tags: ['ip'],
    group: 'network',
  },
  {
    name: 'ipv6 address',
    text: '2001:db8:85a3::8a2e:370:7334',
    tags: ['ip'],
    group: 'network',
  },
  {
    name: 'ipv6 loopback',
    text: '::1',
    tags: ['ip'],
    group: 'network',
  },
  {
    name: 'cidr block',
    text: '192.168.1.0/24',
    tags: ['cidr'],
    group: 'network',
  },
  {
    name: 'mac address',
    text: '00:1A:2B:3C:4D:5E',
    tags: ['mac'],
    group: 'network',
  },
  {
    name: 'subnet mask',
    text: '255.255.255.0',
    tags: ['subnet-mask'],
    notTags: ['ip'],
    group: 'network',
  },
  {
    name: 'host:port',
    text: 'localhost:3000',
    tags: ['port'],
    group: 'network',
  },
  {
    name: 'ip:port',
    text: '10.1.1.5:8443',
    tags: ['port'],
    group: 'network',
  },
  {
    name: 'cisco ios config',
    text: 'interface GigabitEthernet0/1\n ip address 10.0.0.1 255.255.255.0\n no shutdown',
    tags: ['ip', 'subnet-mask'],
    group: 'network', // network config (not generic code); acceptable per spec
  },
  {
    name: 'ip with sentence',
    text: 'The router is at 10.0.0.1 and the DNS server is 1.1.1.1.',
    tags: ['ip'],
    group: 'network',
  },

  // ───────────────────────── Links ─────────────────────────
  {
    name: 'plain url',
    text: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API',
    tags: ['url'],
    group: 'link',
  },
  {
    name: 'url with ip host',
    text: 'http://192.168.0.1/admin',
    tags: ['url'],
    group: 'link', // url-only text stays a link even though the host is an IP
  },
  {
    name: 'email address',
    text: 'student.name+uni@school.edu',
    tags: ['email'],
    group: 'link',
  },
  {
    name: 'prose with url',
    text: 'Check the docs at https://vitest.dev/guide for the full list of matchers.',
    tags: ['url'],
    group: 'link',
  },

  // ───────────────────────── Errors ─────────────────────────
  {
    name: 'python traceback',
    text: 'Traceback (most recent call last):\n  File "main.py", line 3, in <module>\n    print(1/0)\nZeroDivisionError: division by zero',
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'node stack trace',
    text: "TypeError: Cannot read properties of undefined (reading 'map')\n    at render (/app/src/List.js:10:5)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'java exception',
    text: 'Exception in thread "main" java.lang.NullPointerException\n\tat Main.main(Main.java:5)',
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'npm ERR',
    text: 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree',
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'git fatal',
    text: 'fatal: not a git repository (or any of the parent directories): .git',
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'segfault',
    text: 'Segmentation fault (core dumped)',
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'http 404',
    text: 'HTTP/1.1 404 Not Found',
    tags: ['error'],
    group: 'error',
  },
  {
    name: 'syntax error',
    text: 'SyntaxError: Unexpected token } in JSON at position 42',
    tags: ['error'],
    group: 'error',
  },

  // ───────────────────────── Data ─────────────────────────
  {
    name: 'regex literal',
    text: '/^\\d{3}-\\d{4}$/gi',
    tags: ['regex'],
    group: 'data',
  },
  {
    name: 'regex bare pattern',
    text: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
    tags: ['regex'],
    notTags: ['email'],
    group: 'data',
  },
  {
    name: 'hex color',
    text: '#1A2b3C',
    tags: ['hex-color'],
    group: 'data',
  },
  {
    name: 'uuid',
    text: '550e8400-e29b-41d4-a716-446655440000',
    tags: ['uuid'],
    group: 'data',
  },
  {
    name: 'md5 hash',
    text: 'd41d8cd98f00b204e9800998ecf8427e',
    tags: ['hash'],
    group: 'data',
    secret: false,
  },
  {
    name: 'sha256 hash',
    text: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    tags: ['hash'],
    group: 'data',
    secret: false,
  },
  {
    name: 'base64 blob',
    text: 'VGhpcyBpcyBhIGxvbmdlciBiYXNlNjQgZW5jb2RlZCBzdHJpbmcgdXNlZCBmb3IgdGVzdGluZw==',
    tags: ['base64'],
    group: 'data',
  },
  {
    name: 'unix timestamp',
    text: '1700000000',
    tags: ['timestamp'],
    group: 'data',
  },
  {
    name: 'iso timestamp',
    text: '2024-03-15T09:30:00Z',
    tags: ['timestamp'],
    group: 'data',
  },

  // ───────────────────────── Prompts ─────────────────────────
  {
    name: 'role prompt',
    text: 'You are a senior Python developer. Review my code and explain any bugs step by step, then suggest a cleaner version.',
    tags: ['prompt'],
    group: 'prompt',
  },
  {
    name: 'explain prompt',
    text: 'Explain the difference between TCP and UDP in simple terms, with examples, for a first-year networking student.',
    tags: ['prompt'],
    group: 'prompt',
  },
  {
    name: 'rewrite prompt',
    text: 'Rewrite the following paragraph so it sounds more professional and keep it under 100 words:\n\nhey so basically the server went down last night and we fixed it',
    tags: ['prompt'],
    group: 'prompt',
  },
  {
    name: 'template prompt with variables',
    text: '### Instructions\nSummarize the {{article}} in {{num_bullets}} bullet points. Use a neutral tone.',
    tags: ['prompt'],
    group: 'prompt',
  },
  {
    name: 'prompt containing code block',
    text:
      'Fix the bug in the following function and explain step by step what was wrong:\n' +
      FENCE +
      'python\ndef add(a, b):\n    return a - b\n' +
      FENCE,
    tags: ['prompt', 'code', 'python'],
    lang: 'python',
    group: 'prompt',
  },
  {
    name: 'act as prompt',
    text: 'Act as a Linux terminal. I will type commands and you will reply with what the terminal should show. Do not write explanations.',
    tags: ['prompt'],
    group: 'prompt',
  },

  // ───────────────────────── Secrets ─────────────────────────
  {
    name: 'aws access key',
    text: 'AKIAIOSFODNN7EXAMPLE',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'github classic token',
    text: 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'github fine-grained token',
    text: 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'openai style key',
    text: 'OPENAI_API_KEY=sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78St90',
    tags: ['secret'],
    secret: true,
    group: 'data',
  },
  {
    name: 'anthropic style key',
    text: 'sk-ant-api03-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78St90UvWxYz',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'slack token',
    text: 'xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'google api key',
    text: 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'stripe live key',
    text: 'sk_live_4eC39HqLyjWDarjtT1zdp7dc',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'jwt',
    text: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'private key block',
    text: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxample+fake+key+material\n-----END RSA PRIVATE KEY-----',
    tags: ['secret'],
    group: 'data',
    secret: true,
  },
  {
    name: 'password assignment',
    text: 'DB_PASSWORD=hunter2hunter2',
    tags: ['secret'],
    secret: true,
    group: 'data',
  },
  {
    name: 'password in code',
    text: 'const config = { user: "admin", password: "S3cr3t!pass" };\nconsole.log(config);',
    tags: ['secret'],
    secret: true,
    group: 'code',
  },
  {
    name: 'connection string with credentials',
    text: 'postgres://admin:Sup3rS3cret@db.internal.example.com:5432/appdb',
    tags: ['secret'],
    secret: true,
    group: 'data',
  },

  // ───────────────────────── Tricky negatives ─────────────────────────
  {
    name: 'prose with a colon',
    text: 'Here is the thing: you should always back up your data before updating the firmware.',
    notTags: ['yaml', 'code', 'command', 'prompt'],
    group: 'other',
  },
  {
    name: 'select a file from the menu',
    text: 'Please select a file from the menu and then press the green button to continue.',
    notTags: ['sql', 'code'],
    group: 'other',
  },
  {
    name: 'phone number',
    text: '+1 (555) 123-4567',
    notTags: ['ip', 'timestamp', 'port', 'mac'],
    group: 'other',
  },
  {
    // DECISION: a bare dotted quad "1.2.3.4" is indistinguishable from an IP, so it is tagged `ip`.
    // Version strings are only excluded when clearly marked (leading "v" / "version ").
    name: 'bare dotted quad is an ip',
    text: '1.2.3.4',
    tags: ['ip'],
    group: 'network',
  },
  {
    name: 'v-prefixed four-part version',
    text: 'v2.1.0.5',
    notTags: ['ip'],
    group: 'other',
  },
  {
    name: 'semver three parts',
    text: '1.2.3',
    notTags: ['ip'],
    group: 'other',
  },
  {
    name: 'markdown text',
    text: '# Lecture notes\n\n- **Week 1**: intro to networking\n- *Week 2*: the OSI model\n\nRemember to read chapter 3 before class.',
    notTags: ['code', 'yaml', 'command', 'prompt', 'error'],
    group: 'other',
  },
  {
    name: 'single word',
    text: 'hello',
    tags: [],
    group: 'other',
  },
  {
    name: 'short sentence',
    text: 'Meeting moved to 10:30 tomorrow',
    notTags: ['port', 'timestamp', 'ip'],
    group: 'other',
  },
  {
    name: 'prose mentioning error',
    text: 'I got an error yesterday when I tried to log in but it works now.',
    notTags: ['error'],
    group: 'other',
  },
  {
    name: 'prose mentioning git',
    text: 'git is a distributed version control system that tracks changes in source code.',
    notTags: ['command'],
    group: 'other',
  },
  {
    name: 'prose mentioning password',
    text: 'Password: must contain at least eight characters and one number.',
    secret: false,
    group: 'other',
  },
  {
    name: 'long hex is not a secret',
    text: '5d41402abc4b2a76b9719d911017c592',
    secret: false,
    notTags: ['secret'],
    group: 'data',
  },
  {
    name: 'file path with line number',
    text: 'src/components/List.tsx:42',
    notTags: ['port', 'ip'],
    group: 'other',
  },
  {
    name: 'empty-ish whitespace',
    text: '   \n  ',
    tags: [],
    group: 'other',
  },
];
