"""Builds index.html and app.js from src/ and data/tasks.json. Run: python3 build.py"""
import json, re
tasks=json.load(open('data/tasks.json'))
logo=open('assets/logo-white.svg').read()
logo=re.sub(r'width="\d+" height="\d+"','class="logo" role="img" aria-label="Chada Tech"',logo,count=1)
open('index.html','w').write(open('src/index.html').read().replace('<!--LOGO-->',logo))
open('app.js','w').write('// Built by build.py from src/app.js. Edit src/app.js or data/tasks.json, then run: python3 build.py\n'+open('src/app.js').read().replace('/*TASKS*/[]',json.dumps(tasks,ensure_ascii=False,indent=0)))
print('built', len(tasks), 'tasks')
