# Default output (data/)
bash scripts/run-all.sh

# Custom output directory
bash scripts/run-all.sh --output ./output/snacks-recon

# Run individual engines with custom output
node main.js --engine bing --output ./my-results
node main.js --engine duckduckgo --output ./my-results

# Clean with custom output
node parser/cleaner.js --output ./my-results

# Edit blacklist anytime
nano data/blacklist.txt    # add domains, re-run cleaner
