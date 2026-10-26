"""Static coverage inventory, not an inferred runtime call graph."""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = (ROOT / 'frontend/src/App.jsx').read_text(encoding='utf-8')
    imports = {}
    for component, path in re.findall(r'''import (\w+) from ['"]([^'"]+)['"]''', source):
        imports[component] = path
    for component, path in re.findall(r'''const (\w+) = lazy\(\(\) => import\(['"]([^'"]+)['"]\)\)''', source):
        imports[component] = path
    screens = []
    for route, element in re.findall(r'<Route path="([^"]+)" element=\{([^\n]+)', source):
        components = [value for value in re.findall(r'<([A-Z]\w*)', element) if value not in ('RequireAuth', 'Navigate')]
        paths = []
        references = set()
        for component in components:
            base = ROOT / 'frontend/src' / imports.get(component, '')
            candidates = [base, base.with_suffix('.jsx'), base.with_suffix('.js')]
            file = next((p for p in candidates if p.is_file()), None)
            if file:
                paths.append(str(file.relative_to(ROOT)))
                text = file.read_text(encoding='utf-8')
                references.update(re.findall(r"(?:API|api)\.(?:get|post|put|patch|delete)\(\s*([`'\"][^\n,)]+)", text))
                references.update(re.findall(r"from ['\"]([^'\"]*(?:services|hooks)/[^'\"]+)['\"]", text))
        screens.append({'route': route, 'components': components, 'sources': paths,
                        'static_endpoint_or_service_references': sorted(references),
                        'runtime_measured': False})
    endpoints = []
    source_definitions = {}
    for file in (ROOT / 'backend').rglob('*urls.py'):
        tree = ast.parse(file.read_text(encoding='utf-8-sig'))
        aliases = {}
        package = '.'.join(file.relative_to(ROOT / 'backend').parts[:-1])
        for item in tree.body:
            if isinstance(item, ast.ImportFrom):
                module = (package + '.' if item.level else '') + (item.module or '')
                for alias in item.names:
                    aliases[alias.asname or alias.name] = module.rstrip('.') + '.' + alias.name
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('path', 're_path') and len(node.args) > 1:
                route = node.args[0]
                if isinstance(route, ast.Constant) and isinstance(route.value, str):
                    row = {'url_module': str(file.relative_to(ROOT)), 'route': route.value,
                           'callback': ast.unparse(node.args[1]), 'line': node.lineno,
                           'live_endpoint_measured': False}
                    for expression in ast.walk(node.args[1]):
                        if isinstance(expression, ast.Attribute) and isinstance(expression.value, ast.Name):
                            module = aliases.get(expression.value.id)
                            if not module:
                                continue
                            source_path = ROOT / 'backend' / (module.replace('.', '/') + '.py')
                            if source_path.is_file():
                                if source_path not in source_definitions:
                                    source_tree = ast.parse(source_path.read_text(encoding='utf-8-sig'), filename=str(source_path))
                                    source_definitions[source_path] = {definition.name: definition for definition in source_tree.body if isinstance(definition, (ast.FunctionDef, ast.AsyncFunctionDef))}
                                definitions = source_definitions[source_path]
                                definition = definitions.get(expression.attr)
                                if definition:
                                    calls = set()
                                    def collect(definition, depth=0):
                                        for call in ast.walk(definition):
                                            if isinstance(call, ast.Call):
                                                calls.add(ast.unparse(call.func))
                                                if depth < 2 and isinstance(call.func, ast.Name) and call.func.id.startswith('_') and call.func.id in definitions:
                                                    collect(definitions[call.func.id], depth+1)
                                    collect(definition)
                                    row.update(source=str(source_path.relative_to(ROOT)), function=definition.name,
                                        sap_call_references=sorted(call for call in calls if 'sap' in call.lower()),
                                        query_optimization_references=sorted(call for call in calls if any(value in call for value in ('prefetch_related', 'select_related', 'workflow_page', 'cache_', 'lookup_response'))))
                                    break
                    endpoints.append(row)
    result = {'kind': 'static source inventory; references may be dynamic or indirect',
              'screens': screens, 'endpoint_definitions': endpoints}
    target = ROOT / 'scratch/performance-screen-endpoint-map.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'screen_routes': len(screens), 'endpoint_definitions': len(endpoints)}))


if __name__ == '__main__':
    main()
