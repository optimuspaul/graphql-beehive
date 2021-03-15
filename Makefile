.PHONY: push Makefile doc-gen

push:
	git push origin master --tags
	git push --tags

# Minimal makefile for Sphinx documentation
SPHINXOPTS    ?= 
SPHINXBUILD   ?= sphinx-build
SOURCEDIR     = source
BUILDDIR      = build


clean:
	@$(SPHINXBUILD) -E "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS)


# Catch-all target: route all unknown targets to Sphinx using the new
# "make mode" option.  $(O) is meant as a shortcut for $(SPHINXOPTS).
%: Makefile
	@sphinx-apidoc -o "$(SOURCEDIR)" ./src
	@$(SPHINXBUILD) -M $@ -d 4 "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)
