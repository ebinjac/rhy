package main

import (
	"fmt"
	"os"

	"github.com/rhythm-monitoring/rhythm-test-lab/internal/lab"
)

func main() {
	dir := "certs/generated"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	certs, err := lab.EnsureCertificates(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Generated TEST ONLY certificates in %s\nCA: %s\nClient: %s / %s\n", dir, certs.CA.Subject.CommonName, certs.ClientCert, certs.ClientKey)
}
