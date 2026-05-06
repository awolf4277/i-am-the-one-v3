import wsgi

print("WSGI OK:", wsgi.app)
print("ROUTES:")
for route in sorted([str(r) for r in wsgi.app.url_map.iter_rules()]):
    print(" -", route)
